import debug from 'debug';

import { setIntervalImmediately } from '../../../shared/utils/time';
import type { InterfaceType } from '#db/repositories/interface/types';
import type { LocalShellTransport } from '../../transports/local-shell';
import { SshTransport } from '../../transports/ssh';
import { decrypt } from '../../utils/crypto';
import type { RouterType } from '#db/repositories/router/types';
import type {
  Client,
  EngineCapabilities,
  Health,
  Hooks,
  UsageSample,
  VpnEngine,
} from '../types';
import { generateRandomHeaderValue, parseWgDump } from '../wg-like';
import { applySpeedLimit, clearSpeedLimit } from '../wireguard/speedlimit';
import { DnsmasqManager } from '../wireguard/dnsmasq';
import { configgen } from './configgen';

const AWG_DEBUG = debug('AmneziaWG');

interface Transport {
  exec(cmd: string): Promise<{ stdout: string; stderr: string; code?: number | null }>;
  writeFile(path: string, content: string, mode?: number): Promise<void>;
}

/**
 * Strip the prefix length off a CIDR. Tolerates inputs that are already
 * bare addresses ("10.8.0.1" → "10.8.0.1"). Used to feed dnsmasq a literal
 * listen-address — the gateway IP, not the network — derived from whatever
 * CIDR the operator stored (defaults work; non-default CIDRs work too).
 */
function cidrAddress(cidr: string): string {
  const slash = cidr.indexOf('/');
  return slash === -1 ? cidr : cidr.slice(0, slash);
}

function dockerWrap(cmd: string): string {
  const escaped = cmd.replace(/"/g, '\\"');
  return `docker run --rm --cap-add=NET_ADMIN --network=host -v /etc/amnezia:/etc/amnezia -v /etc/wireguard:/etc/wireguard -v /lib/modules:/lib/modules ghcr.io/amnezia-vpn/amneziawg-tools sh -c "${escaped}"`;
}

export class AmneziaWgEngine implements VpnEngine {
  readonly id = 'amneziawg' as const;

  get capabilities(): EngineCapabilities {
    return {
      obfuscation: 'amneziawg-params',
      speedLimit: 'engine-native',
      multiPeerSync: true,
      livePeerStats: true,
    };
  }

  #cronJobStarted = false;
  #localTransport: LocalShellTransport;
  #dockerMode = false;
  #dockerChecked = false;
  #dnsmasq = new DnsmasqManager();

  constructor(transport: LocalShellTransport) {
    this.#localTransport = transport;
  }

  async #getRouter(iface: InterfaceType): Promise<RouterType | undefined> {
    if (typeof Database === 'undefined') {
      return undefined;
    }
    if (iface.routerId === 0) {
      return Database.routers.get(0);
    }
    return Database.routers.get(iface.routerId);
  }

  async #requireRouter(iface: InterfaceType): Promise<RouterType> {
    const router = await this.#getRouter(iface);
    if (!router) {
      throw new Error(`Router not found for interface ${iface.name}`);
    }
    return router;
  }

  #parseCredentials(router: RouterType): Record<string, string> | undefined {
    if (!router.credentialsEncrypted) {
      return undefined;
    }
    try {
      const decrypted = decrypt(router.credentialsEncrypted);
      return JSON.parse(decrypted) as Record<string, string>;
    } catch {
      return undefined;
    }
  }

  async #getTransport(iface: InterfaceType): Promise<Transport> {
    const router = await this.#getRouter(iface);
    if (!router || router.id === 0) {
      return this.#localTransport;
    }

    const creds = this.#parseCredentials(router);
    if (!creds) {
      return this.#localTransport;
    }

    const auth = creds.sshKey
      ? { type: 'key' as const, privateKey: Buffer.from(creds.sshKey, 'base64').toString('utf8'), passphrase: router.sshPassphraseEncrypted ? decrypt(router.sshPassphraseEncrypted) : undefined }
      : { type: 'password' as const, password: creds.apiPassword || '' };

    return new SshTransport({
      host: router.host ?? 'localhost',
      port: router.port ?? undefined,
      user: creds.sshUser ?? creds.apiUser ?? 'root',
      auth,
    });
  }

  async #exec(iface: InterfaceType, cmd: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
    const transport = await this.#getTransport(iface);

    // Detect docker fallback once per engine lifetime (only for awg/awg-quick commands)
    if (!this.#dockerChecked && (cmd.startsWith('awg') || cmd.startsWith('awg-quick'))) {
      this.#dockerChecked = true;
      try {
        await transport.exec('which awg');
        this.#dockerMode = false;
      } catch {
        try {
          await transport.exec('which docker');
          this.#dockerMode = true;
          AWG_DEBUG('awg binary not found; enabling Docker command wrapping');
        } catch {
          this.#dockerMode = false;
        }
      }
    }

    const wrapped = this.#dockerMode && (cmd.startsWith('awg') || cmd.startsWith('awg-quick'))
      ? dockerWrap(cmd)
      : cmd;

    return transport.exec(wrapped) as Promise<{ stdout: string; stderr: string; code: number | null }>;
  }

  async healthCheck(iface: InterfaceType): Promise<Health> {
    try {
      const { stdout } = await this.#exec(iface, `ip link show ${iface.name}`);
      if (stdout.includes(iface.name)) {
        return { ok: true };
      }
      return { ok: false, details: `Interface ${iface.name} is not up` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, details: message };
    }
  }

  async bringUp(iface: InterfaceType): Promise<void> {
    AWG_DEBUG('Starting AmneziaWG engine');

    let wgInterface = iface;

    if (
      wgInterface.privateKey === '---default---' &&
      wgInterface.publicKey === '---default---'
    ) {
      AWG_DEBUG('Generating new Wireguard Keys...');
      const { wg } = await import('../../utils/wgHelper');
      const privateKey = await wg.generatePrivateKey();
      const publicKey = await wg.getPublicKey(privateKey);
      await Database.interfaces.updateKeyPair(privateKey, publicKey);
      wgInterface = await Database.interfaces.get();
      AWG_DEBUG('New Wireguard Keys generated successfully.');
    }

    if (wgInterface.h1 === '0' || !wgInterface.h1) {
      AWG_DEBUG('Generating random AmneziaWG obfuscation parameters...');
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

    AWG_DEBUG(`Starting AmneziaWG interface ${wgInterface.name}`);

    const clients = await Database.clients.getAll();
    const hooks = await Database.hooks.get();

    await this.#writeConfig(wgInterface, clients, hooks);
    await this.#exec(wgInterface, `awg-quick down ${wgInterface.name}`).catch(() => {});

    const userspaceFallback = process.env.WG_QUICK_USERSPACE_IMPLEMENTATION || process.env.WG_I_PREFER_USERSPACE_TO_KERNEL;

    await this.#exec(wgInterface, `awg-quick up ${wgInterface.name}`).catch((err) => {
      if (err?.message?.includes(`Cannot find device "${wgInterface.name}"`)) {
        if (userspaceFallback) {
          console.warn(
            `AmneziaWG kernel module is not available for interface "${wgInterface.name}". ` +
            `Falling back to userspace implementation (${process.env.WG_QUICK_USERSPACE_IMPLEMENTATION || 'wireguard-go'}). ` +
            `Performance may be reduced compared to native kernel mode.`
          );
          // Do not throw; userspace fallback may succeed on retry
          return;
        }
        throw new Error(
          `AmneziaWG exited with the error: Cannot find device "${wgInterface.name}"\nThis usually means that your host's kernel does not support AmneziaWG!`,
          { cause: err.message }
        );
      }
      throw err;
    });

    await this.#sync(wgInterface);
    AWG_DEBUG(`AmneziaWG interface ${wgInterface.name} started successfully`);

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

    AWG_DEBUG('Applying firewall rules');
    await this.#applyFirewall(wgInterface);
    AWG_DEBUG('Firewall rules applied successfully');

    AWG_DEBUG('Re-applying speed limits');
    await this.#reapplySpeedLimits(wgInterface);
    AWG_DEBUG('Speed limits re-applied successfully');

    // Start the embedded DNS resolver if the operator enabled it. Without
    // this, clients with `DNS=10.8.0.1` (the default when embedded_dns is
    // on) get no DNS responder and the tunnel looks "broken" even though
    // packets route fine.
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
      AWG_DEBUG('Starting cron job');
      setIntervalImmediately(() => {
        this.#cronJob().catch((err) => {
          AWG_DEBUG('Running cron job failed');
          console.error(err);
        });
      }, 60 * 1000);
      AWG_DEBUG('Cron job started successfully');
    }
  }

  async bringDown(iface: InterfaceType): Promise<void> {
    await this.#dnsmasq.stop();
    await this.#exec(iface, `awg-quick down ${iface.name}`).catch(() => {});
  }

  async syncInterface(iface: InterfaceType, peers: Client[]): Promise<void> {
    const hooks = await Database.hooks.get();
    await this.#writeConfig(iface, peers, hooks);
    await this.#sync(iface);
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
    const rawDump = await this.#exec(iface, `awg show ${iface.name} dump`);
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

    const transport = await this.#getTransport(iface);
    await applySpeedLimit(transport, iface, peer, upKbps, downKbps);
  }

  async clearSpeedLimit(iface: InterfaceType, peerPublicKey: string): Promise<void> {
    const clients = await Database.clients.getAll();
    const peer = clients.find((c) => c.publicKey === peerPublicKey);
    if (!peer) {
      return;
    }

    const transport = await this.#getTransport(iface);
    await clearSpeedLimit(transport, iface, peer);
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

    AWG_DEBUG('Saving config');
    const configDir = process.env.WG_CONFIG_DIR || '/etc/wireguard';
    const content = result.join('\n\n');
    const transport = await this.#getTransport(iface);
    await transport.writeFile(
      `${configDir}/${iface.name}.conf`,
      content,
      0o600
    );
    AWG_DEBUG('Config saved successfully');
  }

  async #sync(iface: InterfaceType): Promise<void> {
    AWG_DEBUG('Syncing config');
    await this.#exec(iface, `awg syncconf ${iface.name} <(awg-quick strip ${iface.name})`);
    AWG_DEBUG('Config synced successfully');
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
        const transport = await this.#getTransport(iface);
        await applySpeedLimit(transport, iface, peer, sl.upKbps, sl.downKbps);
      } catch (err) {
        AWG_DEBUG(`Failed to reapply speed limit for client ${sl.clientId}:`, err);
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
        AWG_DEBUG(`Client ${client.id} expired`);
        await Database.clients.toggle(client.id, false);
        needsSave = true;
      }
    }

    for (const client of clients) {
      if (
        client.oneTimeLink !== null &&
        new Date() > new Date(client.oneTimeLink.expiresAt)
      ) {
        AWG_DEBUG(`OneTimeLink for Client ${client.id} expired`);
        await Database.oneTimeLinks.delete(client.id);
      }
    }

    if (needsSave) {
      const iface = await Database.interfaces.get();
      await this.syncInterface(iface, await Database.clients.getAll());
    }
  }
}
