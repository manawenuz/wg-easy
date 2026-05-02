import debug from 'debug';
import { parseCidr } from 'cidr-tools';
import { stringifyIp } from 'ip-bigint';

import type { LocalShellTransport } from '../../transports/local-shell';
import type {
  Client,
  EngineCapabilities,
  Health,
  UsageSample,
  VpnEngine,
} from '../types';
import { setIntervalImmediately } from '../../../shared/utils/time';
import {
  applySpeedLimit,
  clearSpeedLimit,
  teardownSpeedLimits,
} from '../wireguard/speedlimit';
import { iptablesTemplate } from '../../utils/template';
import {
  BoringtunProcessManager,
  uapiSet,
  uapiGet,
  parseUapiGet,
} from './process';
import type { InterfaceType } from '#db/repositories/interface/types';

const BT_DEBUG = debug('BoringTun');

function getServerAddresses(
  iface: InterfaceType,
  enableIpv6: boolean
): { ipv4: string; ipv6?: string } {
  const cidr4 = parseCidr(iface.ipv4Cidr);
  const ipv4Addr = stringifyIp({ number: cidr4.start + 1n, version: 4 });

  let ipv6Addr: string | undefined;
  if (enableIpv6) {
    const cidr6 = parseCidr(iface.ipv6Cidr);
    ipv6Addr = stringifyIp({ number: cidr6.start + 1n, version: 6 });
  }

  return {
    ipv4: `${ipv4Addr}/${cidr4.prefix}`,
    ipv6: ipv6Addr ? `${ipv6Addr}/${parseCidr(iface.ipv6Cidr).prefix}` : undefined,
  };
}

function buildPeerUapiConfig(peer: Client): string {
  const lines: string[] = [];
  lines.push(`public_key=${peer.publicKey}`);

  if (peer.preSharedKey) {
    lines.push(`preshared_key=${peer.preSharedKey}`);
  }

  const allowedIps = [
    `${peer.ipv4Address}/32`,
    ...(peer.ipv6Address ? [`${peer.ipv6Address}/128`] : []),
    ...(peer.serverAllowedIps ?? []),
  ];

  lines.push('replace_allowed_ips=true');
  for (const ip of allowedIps) {
    lines.push(`allowed_ip=${ip}`);
  }

  if (peer.persistentKeepalive) {
    lines.push(`persistent_keepalive_interval=${peer.persistentKeepalive}`);
  }

  if (peer.serverEndpoint) {
    lines.push(`endpoint=${peer.serverEndpoint}`);
  }

  return lines.join('\n');
}

export class BoringtunEngine implements VpnEngine {
  readonly id = 'boringtun' as const;

  get capabilities(): EngineCapabilities {
    return {
      obfuscation: 'none',
      speedLimit: 'engine-native',
      multiPeerSync: false,
      livePeerStats: true,
    };
  }

  #cronJobStarted = false;
  #processManager = new BoringtunProcessManager();

  constructor(private readonly transport: LocalShellTransport) {}

  async healthCheck(iface: InterfaceType): Promise<Health> {
    if (!this.#processManager.isRunning(iface.name)) {
      return {
        ok: false,
        details: `BoringTun process for ${iface.name} is not running`,
      };
    }
    try {
      await this.transport.exec(`ip link show ${iface.name}`);
      return { ok: true };
    } catch {
      return { ok: false, details: `Interface ${iface.name} is not up` };
    }
  }

  async bringUp(iface: InterfaceType): Promise<void> {
    BT_DEBUG('Starting BoringTun engine');

    let wgInterface = iface;

    if (
      wgInterface.privateKey === '---default---' &&
      wgInterface.publicKey === '---default---'
    ) {
      BT_DEBUG('Generating new Wireguard Keys...');
      const { wg } = await import('../../utils/wgHelper');
      const privateKey = await wg.generatePrivateKey();
      const publicKey = await wg.getPublicKey(privateKey);
      await Database.interfaces.updateKeyPair(privateKey, publicKey);
      wgInterface = await Database.interfaces.get();
      BT_DEBUG('New Wireguard Keys generated successfully.');
    }

    BT_DEBUG(`Starting BoringTun interface ${wgInterface.name}`);

    const hooks = await Database.hooks.get();
    const clients = await Database.clients.getAll();

    // Run PreUp hook
    if (hooks.preUp) {
      await this.transport.exec(
        iptablesTemplate(hooks.preUp, wgInterface)
      );
    }

    // Start boringtun process
    await this.#processManager.start(wgInterface.name);

    // Configure interface via UAPI
    const socketPath = this.#processManager.uapiSocket(wgInterface.name);
    await uapiSet(
      socketPath,
      `private_key=${wgInterface.privateKey}\nlisten_port=${wgInterface.port}`
    );

    // Set up IP addresses
    const enableIpv6 = !WG_ENV.DISABLE_IPV6;
    const addresses = getServerAddresses(wgInterface, enableIpv6);

    await this.transport.exec(
      `ip addr add ${addresses.ipv4} dev ${wgInterface.name} 2>/dev/null || true`
    );
    if (addresses.ipv6) {
      await this.transport.exec(
        `ip addr add ${addresses.ipv6} dev ${wgInterface.name} 2>/dev/null || true`
      );
    }
    await this.transport.exec(
      `ip link set ${wgInterface.name} up 2>/dev/null || true`
    );

    // Run PostUp hook
    if (hooks.postUp) {
      await this.transport.exec(
        iptablesTemplate(hooks.postUp, wgInterface)
      );
    }

    // Add peers
    for (const client of clients) {
      if (!client.enabled) continue;
      await this.#uapiAddPeer(wgInterface.name, client);
    }

    // Apply firewall
    if (wgInterface.firewallEnabled) {
      const iptablesAvailable = await firewall.isAvailable(enableIpv6);
      if (!iptablesAvailable) {
        const requiredTools = enableIpv6 ? 'iptables/ip6tables' : 'iptables';
        console.warn(
          `WARNING: Per-Client Firewall is enabled but ${requiredTools} is not available. Disabling firewall feature. Please install ${requiredTools} to use this feature.`
        );
        await Database.interfaces.setFirewallEnabled(false);
        wgInterface.firewallEnabled = false;
      }
    }

    BT_DEBUG('Applying firewall rules');
    await this.#applyFirewall(wgInterface);
    BT_DEBUG('Firewall rules applied successfully');

    BT_DEBUG('Re-applying speed limits');
    await this.#reapplySpeedLimits(wgInterface);
    BT_DEBUG('Speed limits re-applied successfully');

    if (!this.#cronJobStarted) {
      this.#cronJobStarted = true;
      BT_DEBUG('Starting cron job');
      setIntervalImmediately(() => {
        this.#cronJob().catch((err) => {
          BT_DEBUG('Running cron job failed');
          console.error(err);
        });
      }, 60 * 1000);
      BT_DEBUG('Cron job started successfully');
    }
  }

  async bringDown(iface: InterfaceType): Promise<void> {
    const hooks = await Database.hooks.get();

    if (hooks.preDown) {
      await this.transport.exec(iptablesTemplate(hooks.preDown, iface));
    }

    await this.#processManager.stop(iface.name);
    await teardownSpeedLimits(this.transport, iface.name);

    if (hooks.postDown) {
      await this.transport.exec(iptablesTemplate(hooks.postDown, iface));
    }
  }

  async syncInterface(iface: InterfaceType, peers: Client[]): Promise<void> {
    const socketPath = this.#processManager.uapiSocket(iface.name);

    // Replace all peers in a single UAPI set
    const lines: string[] = ['replace_peers=true'];
    for (const peer of peers) {
      if (!peer.enabled) continue;
      lines.push(buildPeerUapiConfig(peer));
    }

    await uapiSet(socketPath, lines.join('\n'));
    await this.#applyFirewall(iface);
  }

  async createPeer(iface: InterfaceType, _peer: Client): Promise<void> {
    const peers = await Database.clients.getAll();
    await this.syncInterface(iface, peers);
  }

  async updatePeer(iface: InterfaceType, _peer: Client): Promise<void> {
    const peers = await Database.clients.getAll();
    await this.syncInterface(iface, peers);
  }

  async removePeer(
    iface: InterfaceType,
    _peerPublicKey: string
  ): Promise<void> {
    const peers = await Database.clients.getAll();
    await this.syncInterface(iface, peers);
  }

  async enablePeer(
    iface: InterfaceType,
    _peerPublicKey: string
  ): Promise<void> {
    const peers = await Database.clients.getAll();
    await this.syncInterface(iface, peers);
  }

  async disablePeer(
    iface: InterfaceType,
    _peerPublicKey: string
  ): Promise<void> {
    const peers = await Database.clients.getAll();
    await this.syncInterface(iface, peers);
  }

  async sampleUsage(iface: InterfaceType): Promise<UsageSample[]> {
    const socketPath = this.#processManager.uapiSocket(iface.name);
    const response = await uapiGet(socketPath);
    return parseUapiGet(response);
  }

  async applySpeedLimit(
    iface: InterfaceType,
    peerPublicKey: string,
    upKbps: number,
    downKbps: number
  ): Promise<void> {
    const clients = await Database.clients.getAll();
    const peer = clients.find((c) => c.publicKey === peerPublicKey);
    if (!peer) {
      throw new Error(`Peer with public key ${peerPublicKey} not found`);
    }

    await applySpeedLimit(this.transport, iface, peer, upKbps, downKbps);
  }

  async clearSpeedLimit(
    iface: InterfaceType,
    peerPublicKey: string
  ): Promise<void> {
    const clients = await Database.clients.getAll();
    const peer = clients.find((c) => c.publicKey === peerPublicKey);
    if (!peer) {
      return;
    }

    await clearSpeedLimit(this.transport, iface, peer);
  }

  async #uapiAddPeer(ifaceName: string, peer: Client): Promise<void> {
    const socketPath = this.#processManager.uapiSocket(ifaceName);
    await uapiSet(socketPath, buildPeerUapiConfig(peer));
  }

  async #applyFirewall(iface: InterfaceType): Promise<void> {
    const clients = await Database.clients.getAll();
    const userConfig = await Database.userConfigs.get();
    await firewall.rebuildRules(
      iface,
      clients,
      userConfig,
      !WG_ENV.DISABLE_IPV6
    );
  }

  async #reapplySpeedLimits(iface: InterfaceType): Promise<void> {
    const speedLimits = await Database.speedLimits.getAllForInterface(
      iface.name
    );
    const clients = await Database.clients.getAll();

    for (const sl of speedLimits) {
      const peer = clients.find((c) => c.id === sl.clientId);
      if (!peer || !peer.enabled) continue;
      try {
        await applySpeedLimit(
          this.transport,
          iface,
          peer,
          sl.upKbps,
          sl.downKbps
        );
      } catch (err) {
        BT_DEBUG(
          `Failed to reapply speed limit for client ${sl.clientId}:`
        );
        console.error(err);
      }
    }
  }

  async #cronJob(): Promise<void> {
    const clients = await Database.clients.getAll();
    let needsSave = false;

    for (const client of clients) {
      if (client.enabled !== true) continue;
      if (
        client.expiresAt !== null &&
        new Date() > new Date(client.expiresAt)
      ) {
        BT_DEBUG(`Client ${client.id} expired`);
        await Database.clients.toggle(client.id, false);
        needsSave = true;
      }
    }

    for (const client of clients) {
      if (
        client.oneTimeLink !== null &&
        new Date() > new Date(client.oneTimeLink.expiresAt)
      ) {
        BT_DEBUG(`OneTimeLink for Client ${client.id} expired`);
        await Database.oneTimeLinks.delete(client.id);
      }
    }

    if (needsSave) {
      const iface = await Database.interfaces.get();
      await this.syncInterface(iface, await Database.clients.getAll());
    }
  }
}
