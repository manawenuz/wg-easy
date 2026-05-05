import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RouterType } from '#db/repositories/router/types';
import { encrypt } from '../../utils/crypto';

const sshConstructorCalls: Array<{
  host?: string;
  port?: number;
  user?: string;
  auth?: { type: string; privateKey?: string; passphrase?: string; password?: string };
}> = [];

const mockExec = vi.fn();
const mockClose = vi.fn();

vi.mock('../../transports/ssh', () => ({
  SshTransport: class MockSshTransport {
    constructor(opts: typeof sshConstructorCalls[0]) {
      sshConstructorCalls.push(opts);
    }
    exec = mockExec;
    close = mockClose;
    isConnected = vi.fn(() => true);
  },
}));

vi.mock('../../transports/routeros-api', () => ({
  RouterOsApiTransport: class MockRouterOsApiTransport {
    connect = vi.fn(async () => {});
    print = vi.fn(async () => []);
    close = vi.fn(async () => {});
    isConnected = vi.fn(() => false);
  },
}));

function makeRouter(overrides: Partial<RouterType> = {}): RouterType {
  return {
    id: 1,
    name: 'test-router',
    engineType: 'mikrotik',
    transport: 'routeros-api',
    host: '192.168.1.1',
    port: 8729,
    credentialsEncrypted: null,
    sshPassphraseEncrypted: null,
    enabled: true,
    lastSeen: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('MikroTik sshPassphraseEncrypted', () => {
  beforeEach(() => {
    sshConstructorCalls.length = 0;
    mockExec.mockReset();
    mockClose.mockReset();
  });

  it('engine #getApi passes passphrase to SshTransport when router has sshPassphraseEncrypted', async () => {
    const passphrase = 'my-secret-passphrase';
    const router = makeRouter({
      transport: 'routeros-ssh',
      credentialsEncrypted: encrypt(
        JSON.stringify({
          apiUser: 'admin',
          apiPassword: 'admin',
          sshKey: Buffer.from('test-private-key').toString('base64'),
        })
      ),
      sshPassphraseEncrypted: encrypt(passphrase),
    });

    vi.stubGlobal('Database', {
      routers: {
        get: vi.fn(async () => router),
        updateLastSeen: vi.fn(async () => {}),
      },
    });
    vi.stubGlobal('WG_ENV', { DISABLE_IPV6: false });

    const { MikrotikEngine } = await import('./index');
    const engine = new MikrotikEngine();

    await engine.healthCheck({ name: 'wg0', routerId: 1 } as unknown as Parameters<typeof engine.healthCheck>[0]);

    const sshCall = sshConstructorCalls.find((c) => c.host === '192.168.1.1');
    expect(sshCall).toBeDefined();
    expect(sshCall!.auth).toMatchObject({
      type: 'key',
      passphrase,
    });
  });

  it('engine #getApi does not include passphrase when sshPassphraseEncrypted is null', async () => {
    const router = makeRouter({
      transport: 'routeros-ssh',
      credentialsEncrypted: encrypt(
        JSON.stringify({
          apiUser: 'admin',
          apiPassword: 'admin',
          sshKey: Buffer.from('test-private-key').toString('base64'),
        })
      ),
      sshPassphraseEncrypted: null,
    });

    vi.stubGlobal('Database', {
      routers: {
        get: vi.fn(async () => router),
        updateLastSeen: vi.fn(async () => {}),
      },
    });
    vi.stubGlobal('WG_ENV', { DISABLE_IPV6: false });

    const { MikrotikEngine } = await import('./index');
    const engine = new MikrotikEngine();

    await engine.healthCheck({ name: 'wg0', routerId: 1 } as unknown as Parameters<typeof engine.healthCheck>[0]);

    const sshCall = sshConstructorCalls.find((c) => c.host === '192.168.1.1');
    expect(sshCall).toBeDefined();
    expect(sshCall!.auth).toMatchObject({
      type: 'key',
    });
    expect(sshCall!.auth).not.toHaveProperty('passphrase');
  });

  it('obfuscator deploy passes passphrase to SshTransport when router has sshPassphraseEncrypted', async () => {
    const passphrase = 'obfuscator-passphrase';
    const router = makeRouter({
      transport: 'ssh',
      port: 22,
      credentialsEncrypted: encrypt(
        JSON.stringify({
          apiUser: 'admin',
          apiPassword: 'admin',
          sshKey: Buffer.from('test-private-key').toString('base64'),
        })
      ),
      sshPassphraseEncrypted: encrypt(passphrase),
    });

    mockExec.mockImplementation(async (cmd: string) => {
      if (cmd.includes('/interface/veth/print count-only')) return { stdout: '1', stderr: '', code: 0 };
      if (cmd.includes('/ip/address/print count-only')) return { stdout: '1', stderr: '', code: 0 };
      if (cmd.includes('/container/mounts/print count-only')) return { stdout: '1', stderr: '', code: 0 };
      if (cmd.includes('/container/print count-only where name') && cmd.includes('status')) return { stdout: '1', stderr: '', code: 0 };
      if (cmd.includes('/container/print count-only where name="wg-obfuscator"')) return { stdout: '1', stderr: '', code: 0 };
      if (cmd.includes('/ip/firewall/nat/print count-only')) return { stdout: '1', stderr: '', code: 0 };
      if (cmd.includes('/file/print count-only')) return { stdout: '1', stderr: '', code: 0 };
      return { stdout: '', stderr: '', code: 0 };
    });

    const { deployObfuscator } = await import('./obfuscator');
    await deployObfuscator(router, {
      ifaceName: 'wg-easy',
      listenPort: 51830,
      wgTargetPort: 51820,
    });

    const sshCall = sshConstructorCalls.find((c) => c.host === '192.168.1.1');
    expect(sshCall).toBeDefined();
    expect(sshCall!.auth).toMatchObject({
      type: 'key',
      passphrase,
    });
  });

  it('bootstrap passes passphrase to SshTransport when router has sshPassphraseEncrypted', async () => {
    const passphrase = 'bootstrap-passphrase';
    const router = makeRouter({
      transport: 'ssh',
      port: 22,
      sshPassphraseEncrypted: encrypt(passphrase),
    });

    mockExec.mockImplementation(async (cmd: string) => {
      if (cmd.includes('/system/identity/print')) return { stdout: 'name=RouterOS', stderr: '', code: 0 };
      if (cmd.includes('/system/resource/print')) return { stdout: 'version=7.15.0', stderr: '', code: 0 };
      if (cmd.includes('/interface/wireguard/print count-only')) return { stdout: '1', stderr: '', code: 0 };
      if (cmd.includes('/ip/address/print count-only')) return { stdout: '1', stderr: '', code: 0 };
      if (cmd.includes('/ip/firewall/filter/print count-only')) return { stdout: '1', stderr: '', code: 0 };
      if (cmd.includes('/ip/firewall/nat/print count-only')) return { stdout: '0', stderr: '', code: 0 };
      if (cmd.includes('/ip/route/print')) return { stdout: 'gateway-status=192.168.1.1,ether1 reachable', stderr: '', code: 0 };
      if (cmd.includes('/user/print count-only')) return { stdout: '1', stderr: '', code: 0 };
      if (cmd.includes('/ip/service/print count-only')) return { stdout: '1', stderr: '', code: 0 };
      if (cmd.includes('/certificate/print as-value')) return { stdout: '.fingerprint=EF:GH', stderr: '', code: 0 };
      return { stdout: '', stderr: '', code: 0 };
    });

    vi.stubGlobal('Database', {
      routers: { update: vi.fn(async () => ({})) },
      interfaces: { getByRouterId: vi.fn(async () => []) },
    });

    const { bootstrap } = await import('./bootstrap');
    const events: Array<{ step: string; status: string }> = [];
    await bootstrap(
      router,
      {
        ifaceName: 'wg-easy',
        listenPort: 51820,
        ipv4Cidr: '10.8.0.1/24',
        sshUser: 'admin',
        sshKey: 'test-private-key',
      },
      (e) => events.push(e)
    );

    const sshCall = sshConstructorCalls.find((c) => c.host === '192.168.1.1');
    expect(sshCall).toBeDefined();
    expect(sshCall!.auth).toMatchObject({
      type: 'key',
      passphrase,
    });
  });
});
