import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { LocalShellTransport } from '../../transports/local-shell';

vi.mock('./process', () => ({
  BoringtunProcessManager: class MockBoringtunProcessManager {
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    isRunning = vi.fn().mockReturnValue(true);
    uapiSocket = vi.fn().mockReturnValue('/var/run/wireguard/wg0.sock');
  },
}));

describe('BoringtunEngine', () => {
  let BoringtunEngine: typeof import('./index').BoringtunEngine;
  let engine: import('./index').BoringtunEngine;
  let transportExec: ReturnType<typeof vi.fn>;

  const mockInterface = {
    name: 'wg0',
    device: 'eth0',
    port: 51820,
    privateKey: 'abc123',
    publicKey: 'pub123',
    ipv4Cidr: '10.8.0.0/24',
    ipv6Cidr: 'fd00::/64',
    mtu: 1420,
    jC: 7,
    jMin: 10,
    jMax: 1000,
    s1: 128,
    s2: 56,
    s3: null,
    s4: null,
    h1: '12345',
    h2: '12346',
    h3: '12347',
    h4: '12348',
    i1: null,
    i2: null,
    i3: null,
    i4: null,
    i5: null,
    enabled: true,
    firewallEnabled: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockClient = {
    id: 1,
    name: 'Test Client',
    userId: 1,
    interfaceId: 'wg0',
    ipv4Address: '10.8.0.2',
    ipv6Address: 'fd00::2',
    privateKey: 'clientPriv',
    publicKey: 'clientPub',
    preSharedKey: 'psk',
    preUp: '',
    postUp: '',
    preDown: '',
    postDown: '',
    allowedIps: ['0.0.0.0/0'],
    serverAllowedIps: [],
    firewallIps: null,
    persistentKeepalive: 25,
    mtu: 1420,
    jC: null,
    jMin: null,
    jMax: null,
    i1: null,
    i2: null,
    i3: null,
    i4: null,
    i5: null,
    dns: null,
    serverEndpoint: null,
    expiresAt: null,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockHooks = {
    id: 'wg0',
    preUp: '',
    postUp: '',
    preDown: '',
    postDown: '',
  };

  beforeAll(async () => {
    process.env.WG_CONFIG_DIR = await mkdtemp(join(tmpdir(), 'wg-easy-bt-'));
    transportExec = vi.fn(async () => ({ stdout: '', stderr: '' }));

    const mockTransport = {
      exec: transportExec,
    } as unknown as LocalShellTransport;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Database = {
      clients: {
        getAll: vi.fn(async () => [mockClient]),
        toggle: vi.fn(),
      },
      interfaces: {
        get: vi.fn(async () => mockInterface),
        updateKeyPair: vi.fn(),
        update: vi.fn(),
        setFirewallEnabled: vi.fn(),
      },
      hooks: {
        get: vi.fn(async () => mockHooks),
      },
      userConfigs: {
        get: vi.fn(async () => ({
          id: 'wg0',
          defaultDns: ['1.1.1.1'],
          embeddedDnsEnabled: false,
          dnsUpstream: ['1.1.1.1', '1.0.0.1'],
          defaultAllowedIps: ['0.0.0.0/0', '::/0'],
          defaultMtu: 1420,
          defaultPersistentKeepalive: 25,
          defaultJC: 7,
          defaultJMin: 10,
          defaultJMax: 1000,
          defaultI1: null,
          defaultI2: null,
          defaultI3: null,
          defaultI4: null,
          defaultI5: null,
          host: 'example.com',
          port: 51820,
        })),
      },
      oneTimeLinks: {
        delete: vi.fn(),
      },
      speedLimits: {
        getAllForInterface: vi.fn(async () => []),
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).firewall = {
      isAvailable: vi.fn(async () => true),
      rebuildRules: vi.fn(),
      clearAvailabilityCache: vi.fn(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).WG_ENV = {
      DISABLE_IPV6: false,
      WG_EXECUTABLE: 'wg',
    };

    const mod = await import('./index');
    BoringtunEngine = mod.BoringtunEngine;
    engine = new BoringtunEngine(mockTransport);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct capabilities', () => {
    expect(engine.capabilities).toEqual({
      obfuscation: 'none',
      speedLimit: 'engine-native',
      multiPeerSync: false,
      livePeerStats: true,
    });
  });

  it('healthCheck returns ok when process is running and interface exists', async () => {
    transportExec.mockResolvedValueOnce({ stdout: '1: wg0: ...', stderr: '' });
    const health = await engine.healthCheck(
      mockInterface as unknown as import('#db/repositories/interface/types').InterfaceType
    );
    expect(health.ok).toBe(true);
  });

  it('healthCheck returns not ok when interface is missing', async () => {
    transportExec.mockRejectedValueOnce(new Error('not found'));
    const health = await engine.healthCheck(
      mockInterface as unknown as import('#db/repositories/interface/types').InterfaceType
    );
    expect(health.ok).toBe(false);
  });

  it('syncInterface uses wg setconf to sync peers', async () => {
    await engine.syncInterface(
      mockInterface as unknown as import('#db/repositories/interface/types').InterfaceType,
      [mockClient as unknown as import('../types').Client]
    );

    expect(transportExec).toHaveBeenCalledWith(
      expect.stringContaining('wg setconf wg0')
    );
  });

  it('createPeer delegates to syncInterface', async () => {
    await engine.createPeer(
      mockInterface as unknown as import('#db/repositories/interface/types').InterfaceType,
      mockClient as unknown as import('../types').Client
    );

    expect(transportExec).toHaveBeenCalledWith(
      expect.stringContaining('wg setconf wg0')
    );
  });

  it('removePeer delegates to syncInterface', async () => {
    await engine.removePeer(
      mockInterface as unknown as import('#db/repositories/interface/types').InterfaceType,
      mockClient.publicKey
    );

    expect(transportExec).toHaveBeenCalledWith(
      expect.stringContaining('wg setconf wg0')
    );
  });

  it('sampleUsage parses wg dump output', async () => {
    transportExec.mockResolvedValueOnce({
      stdout:
        'wg0\tprivKey\tpubKey\t51820\nclientPub\t(none)\t0\t1234\t5678\t1710000000\t25\n',
      stderr: '',
    });

    const usage = await engine.sampleUsage(
      mockInterface as unknown as import('#db/repositories/interface/types').InterfaceType
    );

    expect(transportExec).toHaveBeenCalledWith('wg show wg0 dump');
    expect(usage).toBeInstanceOf(Array);
  });

  it('applySpeedLimit issues tc commands', async () => {
    await engine.applySpeedLimit(
      mockInterface as unknown as import('#db/repositories/interface/types').InterfaceType,
      mockClient.publicKey,
      1000,
      2000
    );

    expect(transportExec).toHaveBeenCalledWith(
      expect.stringContaining('tc qdisc add dev wg0 root handle 1: htb')
    );
    expect(transportExec).toHaveBeenCalledWith(
      expect.stringContaining('tc class add dev wg0 parent 1:')
    );
    expect(transportExec).toHaveBeenCalledWith(
      expect.stringContaining('tc filter add dev wg0 protocol ip parent 1:')
    );
    expect(transportExec).toHaveBeenCalledWith(
      expect.stringContaining('tc qdisc add dev wg0 handle ffff: ingress')
    );
  });

  it('clearSpeedLimit issues tc delete commands', async () => {
    await engine.clearSpeedLimit(
      mockInterface as unknown as import('#db/repositories/interface/types').InterfaceType,
      mockClient.publicKey
    );

    expect(transportExec).toHaveBeenCalledWith(
      expect.stringContaining('tc filter del dev wg0 protocol ip parent 1:')
    );
    expect(transportExec).toHaveBeenCalledWith(
      expect.stringContaining('tc filter del dev wg0 parent ffff:')
    );
  });
});
