import { writeFile } from 'node:fs/promises';
import debug from 'debug';
import { parseCidr } from 'cidr-tools';
import { stringifyIp } from 'ip-bigint';

import { configgen } from '../wireguard/configgen';
import { applySpeedLimit, clearSpeedLimit, teardownSpeedLimits } from '../wireguard/speedlimit';
import type { LocalShellTransport } from '../../transports/local-shell';
import type {
  VpnEngine,
  EngineCapabilities,
  UsageSample,
  Health,
  Client,
  Hooks,
} from '../types';
import type { InterfaceType } from '#db/repositories/interface/types';
import { setIntervalImmediately } from '../../../shared/utils/time';
import { parseWgDump } from '../wg-like';
import { BoringtunProcessManager } from './process';

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

    const clients = await Database.clients.getAll();
    const hooks = await Database.hooks.get();

    // Run PreUp hook
    if (hooks.preUp) {
      await this.transport.exec(
        iptablesTemplate(hooks.preUp, wgInterface)
      );
    }

    // Start boringtun process
    await this.#processManager.start(wgInterface.name);

    // Write config and apply via wg setconf
    await this.#writeConfig(wgInterface, clients, hooks);
    await this.transport.exec(
      `wg setconf ${wgInterface.name} <(wg-quick strip /etc/wireguard/${wgInterface.name}.conf)`
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
    const hooks = await Database.hooks.get();
    await this.#writeConfig(iface, peers, hooks);
    await this.transport.exec(
      `wg setconf ${iface.name} <(wg-quick strip /etc/wireguard/${iface.name}.conf)`
    );
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
    const rawDump = await this.transport.exec(`wg show ${iface.name} dump`);
    return parseWgDump(rawDump.stdout);
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

  async #writeConfig(
    iface: InterfaceType,
    clients: Client[],
    hooks: Hooks
  ): Promise<void> {
    const result = [];
    result.push(
      configgen.generateServerInterface(iface, hooks, {
        enableIpv6: !WG_ENV.DISABLE_IPV6,
        engineType: 'wireguard',
      })
    );

    for (const client of clients) {
      if (!client.enabled) {
        continue;
      }
      result.push(
        configgen.generateServerPeer(client, {
          enableIpv6: !WG_ENV.DISABLE_IPV6,
        })
      );
    }

    result.push('');

    BT_DEBUG('Saving config');
    const configDir = process.env.WG_CONFIG_DIR || '/etc/wireguard';
    await writeFile(
      `${configDir}/${iface.name}.conf`,
      result.join('\n\n'),
      {
        mode: 0o600,
      }
    );
    BT_DEBUG('Config saved successfully');
  }

  async #applyFirewall(iface: InterfaceType): Promise<void> {
    const clients = await Database.clients.getAll();
    const userConfig = await Database.userConfigs.get();
    await firewall.rebuildRules(iface, clients, userConfig, !WG_ENV.DISABLE_IPV6);
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
