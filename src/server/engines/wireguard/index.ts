import { writeFile } from 'node:fs/promises';
import debug from 'debug';

import { configgen } from './configgen';
import { applySpeedLimit, clearSpeedLimit } from './speedlimit';
import { DnsmasqManager } from './dnsmasq';
import type { LocalShellTransport } from '../../transports/local-shell';
import type {
  VpnEngine,
  EngineCapabilities,
  UsageSample,
  Health,
} from '../types';
import type { InterfaceType } from '#db/repositories/interface/types';
import type { Client, Hooks } from '../types';
import { setIntervalImmediately } from '../../../shared/utils/time';
import { parseWgDump } from '../wg-like';

const WG_DEBUG = debug('WireGuard');

function cidrAddress(cidr: string): string {
  const slash = cidr.indexOf('/');
  return slash === -1 ? cidr : cidr.slice(0, slash);
}

export class WireguardEngine implements VpnEngine {
  readonly id = 'wireguard' as const;
  get capabilities(): EngineCapabilities {
    return {
      obfuscation: 'none',
      speedLimit: 'engine-native',
      multiPeerSync: true,
      livePeerStats: true,
    };
  }

  #cronJobStarted = false;
  #dnsmasq = new DnsmasqManager();

  constructor(private readonly transport: LocalShellTransport) {}

  async healthCheck(iface: InterfaceType): Promise<Health> {
    try {
      await this.transport.exec(`ip link show ${iface.name}`);
      return { ok: true };
    } catch {
      return { ok: false, details: `Interface ${iface.name} is not up` };
    }
  }

  async bringUp(iface: InterfaceType): Promise<void> {
    WG_DEBUG('Starting Wireguard engine');

    let wgInterface = iface;

    if (
      wgInterface.privateKey === '---default---' &&
      wgInterface.publicKey === '---default---'
    ) {
      WG_DEBUG('Generating new Wireguard Keys...');
      const { wg } = await import('../../utils/wgHelper');
      const privateKey = await wg.generatePrivateKey();
      const publicKey = await wg.getPublicKey(privateKey);
      await Database.interfaces.updateKeyPair(privateKey, publicKey);
      wgInterface = await Database.interfaces.get();
      WG_DEBUG('New Wireguard Keys generated successfully.');
    }

    WG_DEBUG(`Starting Wireguard interface ${wgInterface.name}`);

    const clients = await Database.clients.getAll();
    const hooks = await Database.hooks.get();

    await this.#writeConfig(wgInterface, clients, hooks);
    await this.transport.exec(`wg-quick down ${wgInterface.name}`).catch(() => {});
    await this.transport.exec(`wg-quick up ${wgInterface.name}`).catch((err) => {
      if (err?.message?.includes(`Cannot find device "${wgInterface.name}"`)) {
        throw new Error(
          `WireGuard exited with the error: Cannot find device "${wgInterface.name}"\nThis usually means that your host's kernel does not support WireGuard!`,
          { cause: err.message }
        );
      }
      throw err;
    });
    await this.#sync(wgInterface.name);
    WG_DEBUG(`Wireguard interface ${wgInterface.name} started successfully`);

    if (wgInterface.firewallEnabled) {
      const enableIpv6 = !WG_ENV.DISABLE_IPV6;
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

    WG_DEBUG('Applying firewall rules');
    await this.#applyFirewall(wgInterface);
    WG_DEBUG('Firewall rules applied successfully');

    WG_DEBUG('Re-applying speed limits');
    await this.#reapplySpeedLimits(wgInterface);
    WG_DEBUG('Speed limits re-applied successfully');

    // Start embedded DNS resolver if enabled
    const userConfig = await Database.userConfigs.get();
    if (userConfig.embeddedDnsEnabled) {
      await this.#dnsmasq.start(userConfig.dnsUpstream, !WG_ENV.DISABLE_IPV6, {
        ifaceName: wgInterface.name,
        ipv4: cidrAddress(wgInterface.ipv4Cidr),
        ipv6: WG_ENV.DISABLE_IPV6 ? null : cidrAddress(wgInterface.ipv6Cidr),
      });
    }

    if (!this.#cronJobStarted) {
      this.#cronJobStarted = true;
      WG_DEBUG('Starting cron job');
      setIntervalImmediately(() => {
        this.#cronJob().catch((err) => {
          WG_DEBUG('Running cron job failed');
          console.error(err);
        });
      }, 60 * 1000);
      WG_DEBUG('Cron job started successfully');
    }
  }

  async bringDown(iface: InterfaceType): Promise<void> {
    await this.#dnsmasq.stop();
    await this.transport.exec(`wg-quick down ${iface.name}`).catch(() => {});
  }

  async syncInterface(iface: InterfaceType, peers: Client[]): Promise<void> {
    const hooks = await Database.hooks.get();
    await this.#writeConfig(iface, peers, hooks);
    await this.#sync(iface.name);
    await this.#applyFirewall(iface);
    const userConfig = await Database.userConfigs.get();
    if (userConfig.embeddedDnsEnabled) {
      await this.#dnsmasq.reload(userConfig.dnsUpstream, !WG_ENV.DISABLE_IPV6, {
        ifaceName: iface.name,
        ipv4: cidrAddress(iface.ipv4Cidr),
        ipv6: WG_ENV.DISABLE_IPV6 ? null : cidrAddress(iface.ipv6Cidr),
      });
    } else {
      await this.#dnsmasq.stop();
    }
  }

  async createPeer(iface: InterfaceType, _peer: Client): Promise<void> {
    const peers = await Database.clients.getAll();
    await this.syncInterface(iface, peers);
  }

  async updatePeer(iface: InterfaceType, _peer: Client): Promise<void> {
    const peers = await Database.clients.getAll();
    await this.syncInterface(iface, peers);
  }

  async removePeer(iface: InterfaceType, _peerPublicKey: string): Promise<void> {
    const peers = await Database.clients.getAll();
    await this.syncInterface(iface, peers);
  }

  async enablePeer(iface: InterfaceType, _peerPublicKey: string): Promise<void> {
    const peers = await Database.clients.getAll();
    await this.syncInterface(iface, peers);
  }

  async disablePeer(iface: InterfaceType, _peerPublicKey: string): Promise<void> {
    const peers = await Database.clients.getAll();
    await this.syncInterface(iface, peers);
  }

  async sampleUsage(iface: InterfaceType): Promise<UsageSample[]> {
    const rawDump = await this.transport.exec(
      `wg show ${iface.name} dump`
    );
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

  async clearSpeedLimit(iface: InterfaceType, peerPublicKey: string): Promise<void> {
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

    WG_DEBUG('Saving config');
    const configDir = process.env.WG_CONFIG_DIR || '/etc/wireguard';
    await writeFile(
      `${configDir}/${iface.name}.conf`,
      result.join('\n\n'),
      {
        mode: 0o600,
      }
    );
    WG_DEBUG('Config saved successfully');
  }

  async #sync(ifaceName: string): Promise<void> {
    WG_DEBUG('Syncing config');
    await this.transport.exec(
      `wg syncconf ${ifaceName} <(wg-quick strip ${ifaceName})`
    );
    WG_DEBUG('Config synced successfully');
  }

  async #applyFirewall(iface: InterfaceType): Promise<void> {
    const clients = await Database.clients.getAll();
    const userConfig = await Database.userConfigs.get();
    await firewall.rebuildRules(iface, clients, userConfig, !WG_ENV.DISABLE_IPV6);
  }

  async #reapplySpeedLimits(iface: InterfaceType): Promise<void> {
    const speedLimits = await Database.speedLimits.getAllForInterface(iface.name);
    const clients = await Database.clients.getAll();

    for (const sl of speedLimits) {
      const peer = clients.find((c) => c.id === sl.clientId);
      if (!peer || !peer.enabled) continue;
      try {
        await applySpeedLimit(this.transport, iface, peer, sl.upKbps, sl.downKbps);
      } catch (err) {
        WG_DEBUG(`Failed to reapply speed limit for client ${sl.clientId}:`, err);
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
        WG_DEBUG(`Client ${client.id} expired`);
        await Database.clients.toggle(client.id, false);
        needsSave = true;
      }
    }

    for (const client of clients) {
      if (
        client.oneTimeLink !== null &&
        new Date() > new Date(client.oneTimeLink.expiresAt)
      ) {
        WG_DEBUG(`OneTimeLink for Client ${client.id} expired`);
        await Database.oneTimeLinks.delete(client.id);
      }
    }

    if (needsSave) {
      const iface = await Database.interfaces.get();
      await this.syncInterface(iface, await Database.clients.getAll());
    }
  }
}
