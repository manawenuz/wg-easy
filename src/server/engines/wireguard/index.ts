import { writeFile } from 'node:fs/promises';
import debug from 'debug';

import { configgen } from './configgen';
import { applySpeedLimit, clearSpeedLimit } from './speedlimit';
import type { LocalShellTransport } from '../../transports/local-shell';
import type {
  VpnEngine,
  EngineCapabilities,
  UsageSample,
  Health,
} from '../types';
import type { InterfaceType } from '#db/repositories/interface/types';
import type { Client, Hooks } from '../types';
import { setIntervalImmediately, isPeerConnected } from '../../../shared/utils/time';

const WG_DEBUG = debug('WireGuard');

function hashPublicKey(publicKey: string): number {
  let hash = 0;
  for (let i = 0; i < publicKey.length; i++) {
    hash = (hash << 5) - hash + publicKey.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 10000 + 2;
}

function generateRandomHeaderValue() {
  return Math.floor(Math.random() * 2147483642) + 5;
}

export class WireguardEngine implements VpnEngine {
  readonly id = 'wireguard' as const;
  get capabilities(): EngineCapabilities {
    return {
      obfuscation: this.executable === 'awg' ? 'amneziawg-params' : 'none',
      speedLimit: 'engine-native',
      multiPeerSync: true,
      livePeerStats: true,
    };
  }

  #cronJobStarted = false;

  constructor(
    private readonly transport: LocalShellTransport,
    private readonly executable: string = 'wg'
  ) {}

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

    if (wgInterface.h1 === '0') {
      WG_DEBUG('Generating random AmneziaWG obfuscation parameters...');
      const headers = new Set<number>();
      while (headers.size < 4) {
        headers.add(generateRandomHeaderValue());
      }
      const [h1, h2, h3, h4] = Array.from(headers);
      wgInterface.h1 = String(h1)!;
      wgInterface.h2 = String(h2)!;
      wgInterface.h3 = String(h3)!;
      wgInterface.h4 = String(h4)!;
      await Database.interfaces.update(wgInterface);
    }

    WG_DEBUG(`Starting Wireguard interface ${wgInterface.name}`);

    const clients = await Database.clients.getAll();
    const hooks = await Database.hooks.get();

    await this.#writeConfig(wgInterface, clients, hooks);
    await this.transport.exec(`${this.executable}-quick down ${wgInterface.name}`).catch(() => {});
    await this.transport.exec(`${this.executable}-quick up ${wgInterface.name}`).catch((err) => {
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
    await this.transport.exec(`${this.executable}-quick down ${iface.name}`).catch(() => {});
  }

  async syncInterface(iface: InterfaceType, peers: Client[]): Promise<void> {
    const hooks = await Database.hooks.get();
    await this.#writeConfig(iface, peers, hooks);
    await this.#sync(iface.name);
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
      `${this.executable} show ${iface.name} dump`
    );

    type WgDumpLine = [string, string, string, string, string, string, string, string];

    return rawDump.stdout
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => {
        const splitLines = line.split('\t');
        const [
          publicKey,
          _preSharedKey,
          endpoint,
          _allowedIps,
          latestHandshakeAt,
          transferRx,
          transferTx,
          _persistentKeepalive,
        ] = splitLines as WgDumpLine;

        return {
          publicKey,
          rxBytes: BigInt(transferRx),
          txBytes: BigInt(transferTx),
          lastHandshakeAt:
            latestHandshakeAt === '0'
              ? null
              : new Date(Number.parseInt(`${latestHandshakeAt}000`)),
          endpoint: endpoint === '(none)' ? null : endpoint,
        };
      });
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
        executable: this.executable,
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
    await writeFile(
      `/etc/wireguard/${iface.name}.conf`,
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
      `${this.executable} syncconf ${ifaceName} <(${this.executable}-quick strip ${ifaceName})`
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
