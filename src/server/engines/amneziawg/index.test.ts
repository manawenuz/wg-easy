import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { LocalShellTransport } from '../../transports/local-shell';

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
}));

describe('AmneziaWgEngine', () => {
  let AmneziaWgEngine: typeof import('./index').AmneziaWgEngine;
  let engine: import('./index').AmneziaWgEngine;
  let transportExec: ReturnType<typeof vi.fn>;
  let fsWriteFile: ReturnType<typeof vi.fn>;

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
    engineType: 'amneziawg',
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
    transportExec = vi.fn(async () => ({ stdout: '', stderr: '' }));

    const mockTransport = {
      exec: transportExec,
    } as unknown as LocalShellTransport;

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
    };

    (globalThis as any).firewall = {
      isAvailable: vi.fn(async () => true),
      rebuildRules: vi.fn(),
      clearAvailabilityCache: vi.fn(),
    };

    (globalThis as any).WG_ENV = {
      DISABLE_IPV6: false,
      WG_EXECUTABLE: 'awg',
    };

    const mod = await import('./index');
    AmneziaWgEngine = mod.AmneziaWgEngine;
    engine = new AmneziaWgEngine(mockTransport);

    fsWriteFile = vi.mocked(
      await import('node:fs/promises')
    ).writeFile;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct capabilities', () => {
    expect(engine.capabilities).toMatchObject({
      obfuscation: 'amneziawg-params',
      speedLimit: 'engine-native',
      multiPeerSync: true,
      livePeerStats: true,
    });
  });

  it('syncInterface writes config with AWG params and calls awg syncconf', async () => {
    await engine.syncInterface(mockInterface as any, [mockClient as any]);

    expect(fsWriteFile).toHaveBeenCalledOnce();
    const configText = fsWriteFile.mock.calls[0]![1] as string;
    expect(configText).toContain('[Interface]');
    expect(configText).toContain('PrivateKey = abc123');
    expect(configText).toContain('Jc = 7');
    expect(configText).toContain('Jmin = 10');
    expect(configText).toContain('Jmax = 1000');
    expect(configText).toContain('S1 = 128');
    expect(configText).toContain('H1 = 12345');
    expect(configText).toContain('[Peer]');
    expect(configText).toContain('PublicKey = clientPub');

    expect(transportExec).toHaveBeenCalledWith(
      expect.stringContaining('awg syncconf wg0')
    );
  });

  it('createPeer delegates to syncInterface', async () => {
    await engine.createPeer(mockInterface as any, mockClient as any);

    expect(fsWriteFile).toHaveBeenCalledOnce();
    expect(transportExec).toHaveBeenCalledWith(
      expect.stringContaining('awg syncconf wg0')
    );
  });

  it('sampleUsage parses awg show dump correctly', async () => {
    transportExec.mockResolvedValueOnce({
      stdout:
        'privateKey\t-\t(none)\t(none)\t0\t0\t0\t0\n' +
        'pubKey1\t(none)\t(none)\t10.8.0.2/32\t0\t1234\t5678\t0\n' +
        'pubKey2\t-\t1.2.3.4:51820\t10.8.0.3/32\t1710000000\t100\t200\t25',
      stderr: '',
    });

    const usage = await engine.sampleUsage(mockInterface as any);

    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({
      publicKey: 'pubKey1',
      rxBytes: 1234n,
      txBytes: 5678n,
      lastHandshakeAt: null,
      endpoint: null,
    });
    expect(usage[1]).toMatchObject({
      publicKey: 'pubKey2',
      rxBytes: 100n,
      txBytes: 200n,
      lastHandshakeAt: new Date(1710000000000),
      endpoint: '1.2.3.4:51820',
    });
  });

  it('applySpeedLimit issues tc commands', async () => {
    await engine.applySpeedLimit(
      mockInterface as any,
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
      mockInterface as any,
      mockClient.publicKey
    );

    expect(transportExec).toHaveBeenCalledWith(
      expect.stringContaining('tc filter del dev wg0 protocol ip parent 1:')
    );
    expect(transportExec).toHaveBeenCalledWith(
      expect.stringContaining('tc filter del dev wg0 parent ffff:')
    );
  });

  it('healthCheck returns ok when interface exists', async () => {
    transportExec.mockResolvedValueOnce({ stdout: '1: wg0: ...', stderr: '' });
    const health = await engine.healthCheck(mockInterface as any);
    expect(health.ok).toBe(true);
  });

  it('healthCheck returns not ok when interface is missing', async () => {
    transportExec.mockRejectedValueOnce(new Error('not found'));
    const health = await engine.healthCheck(mockInterface as any);
    expect(health.ok).toBe(false);
  });
});
