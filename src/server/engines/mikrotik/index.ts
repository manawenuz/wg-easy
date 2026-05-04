import debug from 'debug';

import { RouterOsApiTransport } from '../../transports/routeros-api';
import { SshTransport } from '../../transports/ssh';
import { decrypt } from '../../utils/crypto';
import type {
  VpnEngine,
  EngineCapabilities,
  UsageSample,
  Health,
  Client,
} from '../types';
import { configgen } from './configgen';
import { speedlimit } from './speedlimit';
import { usage } from './usage';
import { bootstrap as runBootstrap, type BootstrapOptions, type ProgressEvent } from './bootstrap';
import {
  deployObfuscator,
  removeObfuscator,
  generateClientObfuscatorConfig,
  type DeployOptions,
  type ObfuscatorConfig,
} from './obfuscator';
import type { InterfaceType } from '#db/repositories/interface/types';
import type { RouterType } from '#db/repositories/router/types';

const MT_DEBUG = debug('MikroTik');

interface RouterCredentials {
  apiUser?: string;
  apiPassword?: string;
  sshUser?: string;
  sshKey?: string;
  tlsFingerprint?: string;
  sshPassphraseEncrypted?: string;
}

interface ConnectionEntry {
  api: RouterOsApiTransport;
  ssh: SshTransport;
}

export class MikrotikEngine implements VpnEngine {
  readonly id = 'mikrotik' as const;

  get capabilities(): EngineCapabilities {
    return {
      obfuscation: 'wg-obfuscator-sidecar',
      speedLimit: 'engine-native',
      multiPeerSync: false,
      livePeerStats: true,
    };
  }

  #pool = new Map<ID, ConnectionEntry>();

  async healthCheck(iface: InterfaceType): Promise<Health> {
    const router = await this.#getRouter(iface);
    if (!router) {
      return { ok: false, details: 'Router not found' };
    }

    try {
      const api = await this.#getApi(router);
      const rows = await api.print('/system/identity');
      const version = rows[0] ? String(rows[0].name ?? rows[0].version ?? 'unknown') : 'unknown';

      await Database.routers.updateLastSeen(router.id, new Date());

      return { ok: true, details: version };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      MT_DEBUG('healthCheck failed:', message);
      return { ok: false, details: message };
    }
  }

  async bringUp(iface: InterfaceType): Promise<void> {
    const router = await this.#requireRouter(iface);
    const api = await this.#getApi(router);
    await api.exec('/interface', 'enable', { name: iface.name });
  }

  async bringDown(iface: InterfaceType): Promise<void> {
    const router = await this.#requireRouter(iface);
    const api = await this.#getApi(router);
    await api.exec('/interface', 'disable', { name: iface.name });
  }

  async syncInterface(iface: InterfaceType, peers: Client[]): Promise<void> {
    const router = await this.#requireRouter(iface);
    const api = await this.#getApi(router);

    const current = await api.print('/interface/wireguard/peers', {
      interface: iface.name,
    });

    const enableIpv6 = !WG_ENV.DISABLE_IPV6;
    const ops = configgen.diffPeers(iface, peers, current, enableIpv6);

    for (const op of ops) {
      switch (op.action) {
        case 'add':
          await api.write(op.path, op.params);
          break;
        case 'set':
          await api.set(op.path, op.id, op.params);
          break;
        case 'remove':
          await api.remove(op.path, op.id);
          break;
      }
    }
  }

  async createPeer(iface: InterfaceType, peer: Client): Promise<void> {
    const router = await this.#requireRouter(iface);
    const api = await this.#getApi(router);
    const enableIpv6 = !WG_ENV.DISABLE_IPV6;
    const params = configgen.generatePeerParams(iface, peer, enableIpv6);
    await api.write('/interface/wireguard/peers', params);
  }

  async updatePeer(iface: InterfaceType, peer: Client): Promise<void> {
    const router = await this.#requireRouter(iface);
    const api = await this.#getApi(router);
    const mikrotikId = await this.#findPeerId(api, iface, peer.publicKey);
    if (!mikrotikId) {
      throw new Error(`Peer ${peer.publicKey} not found on router`);
    }
    const enableIpv6 = !WG_ENV.DISABLE_IPV6;
    const params = configgen.generatePeerParams(iface, peer, enableIpv6);
    await api.set('/interface/wireguard/peers', mikrotikId, params);
  }

  async removePeer(iface: InterfaceType, peerPublicKey: string): Promise<void> {
    const router = await this.#requireRouter(iface);
    const api = await this.#getApi(router);
    const mikrotikId = await this.#findPeerId(api, iface, peerPublicKey);
    if (!mikrotikId) {
      return;
    }
    await api.remove('/interface/wireguard/peers', mikrotikId);
  }

  async enablePeer(iface: InterfaceType, peerPublicKey: string): Promise<void> {
    const router = await this.#requireRouter(iface);
    const api = await this.#getApi(router);
    const mikrotikId = await this.#findPeerId(api, iface, peerPublicKey);
    if (!mikrotikId) {
      throw new Error(`Peer ${peerPublicKey} not found on router`);
    }
    await api.set('/interface/wireguard/peers', mikrotikId, { disabled: 'no' });
  }

  async disablePeer(iface: InterfaceType, peerPublicKey: string): Promise<void> {
    const router = await this.#requireRouter(iface);
    const api = await this.#getApi(router);
    const mikrotikId = await this.#findPeerId(api, iface, peerPublicKey);
    if (!mikrotikId) {
      throw new Error(`Peer ${peerPublicKey} not found on router`);
    }
    await api.set('/interface/wireguard/peers', mikrotikId, { disabled: 'yes' });
  }

  async sampleUsage(iface: InterfaceType): Promise<UsageSample[]> {
    const router = await this.#requireRouter(iface);
    const api = await this.#getApi(router);
    const rows = await api.print('/interface/wireguard/peers', {
      interface: iface.name,
      stats: '',
    });
    return usage.parseUsageSamples(rows as Array<Record<string, unknown>>);
  }

  async applySpeedLimit(
    iface: InterfaceType,
    peerPublicKey: string,
    upKbps: number,
    downKbps: number
  ): Promise<void> {
    const router = await this.#requireRouter(iface);
    const api = await this.#getApi(router);
    const peer = await this.#findClient(peerPublicKey);
    if (!peer) {
      throw new Error(`Peer ${peerPublicKey} not found`);
    }
    await speedlimit.applySpeedLimit(api, peer, upKbps, downKbps);
  }

  async clearSpeedLimit(iface: InterfaceType, peerPublicKey: string): Promise<void> {
    const router = await this.#requireRouter(iface);
    const api = await this.#getApi(router);
    const peer = await this.#findClient(peerPublicKey);
    if (!peer) {
      return;
    }
    await speedlimit.clearSpeedLimit(api, peer);
  }

  async #getRouter(iface: InterfaceType): Promise<RouterType | undefined> {
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

  async #getApi(router: RouterType): Promise<RouterOsApiTransport> {
    const entry = this.#pool.get(router.id);
    if (entry) {
      if (entry.api.isConnected()) {
        return entry.api;
      }
      // Stale connection, remove and reconnect
      await entry.api.close();
      this.#pool.delete(router.id);
    }

    const creds = this.#parseCredentials(router);
    if (!creds.apiUser || !creds.apiPassword) {
      throw new Error(`Router ${router.id} is missing API credentials`);
    }

    const api = new RouterOsApiTransport({
      host: router.host ?? 'localhost',
      port: router.port ?? undefined,
      user: creds.apiUser,
      password: creds.apiPassword,
    });

    try {
      await api.connect();
    } catch (err) {
      api.scheduleReconnect();
      throw err;
    }

    const ssh = new SshTransport({
      host: router.host ?? 'localhost',
      port: router.port ?? undefined,
      user: creds.sshUser ?? creds.apiUser ?? 'admin',
      auth: creds.sshKey
        ? {
            type: 'key',
            privateKey: Buffer.from(creds.sshKey, 'base64').toString('utf8'),
            ...(router.sshPassphraseEncrypted ? { passphrase: decrypt(router.sshPassphraseEncrypted) } : {}),
          }
        : { type: 'password', password: creds.apiPassword },
    });

    this.#pool.set(router.id, { api, ssh });
    return api;
  }

  #parseCredentials(router: RouterType): RouterCredentials {
    if (!router.credentialsEncrypted) {
      return {};
    }
    try {
      const decrypted = decrypt(router.credentialsEncrypted);
      return JSON.parse(decrypted) as RouterCredentials;
    } catch {
      return {};
    }
  }

  async #findPeerId(
    api: RouterOsApiTransport,
    iface: InterfaceType,
    publicKey: string
  ): Promise<string | null> {
    const rows = await api.print('/interface/wireguard/peers', {
      interface: iface.name,
      'public-key': publicKey,
    });
    if (rows.length === 0) {
      return null;
    }
    const id = String(rows[0]!['.id'] ?? rows[0]!.id ?? '');
    return id || null;
  }

  async #findClient(publicKey: string): Promise<Client | undefined> {
    const result = await Database.clients.findByPublicKey(publicKey);
    if (!result) {
      return undefined;
    }
    return result as unknown as Client;
  }

  async deployObfuscator(
    iface: InterfaceType,
    opts: DeployOptions
  ): Promise<ObfuscatorConfig> {
    const router = await this.#requireRouter(iface);
    return deployObfuscator(router, opts);
  }

  async removeObfuscator(iface: InterfaceType): Promise<void> {
    const router = await this.#requireRouter(iface);
    return removeObfuscator(router);
  }

  generateClientObfuscatorConfig(
    routerHost: string,
    obfuscatorConfig: ObfuscatorConfig
  ): string {
    return generateClientObfuscatorConfig(routerHost, obfuscatorConfig);
  }

  async bootstrap(
    router: RouterType,
    opts: BootstrapOptions,
    emit: (e: ProgressEvent) => void
  ): Promise<void> {
    return runBootstrap(router, opts, emit);
  }
}
