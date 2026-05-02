import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bootstrap } from './bootstrap';
import type { RouterType } from '#db/repositories/router/types';

const { mockExec, mockClose } = vi.hoisted(() => ({
  mockExec: vi.fn(),
  mockClose: vi.fn(),
}));

vi.mock('../../transports/ssh', () => {
  return {
    SshTransport: class MockSshTransport {
      exec = mockExec;
      close = mockClose;
    },
  };
});

vi.mock('../../transports/routeros-api', () => {
  return {
    RouterOsApiTransport: class MockRouterOsApiTransport {
      connect = vi.fn(async () => {});
      print = vi.fn(async () => []);
      close = vi.fn(async () => {});
    },
  };
});

function makeRouter(overrides: Partial<RouterType> = {}): RouterType {
  return {
    id: 1,
    name: 'test-router',
    engineType: 'mikrotik',
    transport: 'ssh',
    host: '192.168.1.1',
    port: 22,
    credentialsEncrypted: null,
    enabled: true,
    lastSeen: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setupSshResponses(
  responses: Array<{ match: string | RegExp; stdout?: string; stderr?: string; code?: number | null }>
) {
  mockExec.mockImplementation(async (cmd: string) => {
    for (const r of responses) {
      const matches = typeof r.match === 'string' ? cmd.includes(r.match) : r.match.test(cmd);
      if (matches) {
        return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.code ?? 0 };
      }
    }
    return { stdout: '', stderr: '', code: 0 };
  });
}

function collectEvents(): { events: Array<{ step: string; status: 'ok' | 'error' | 'pending'; detail?: string; recovery?: string }>; emit: (e: { step: string; status: 'ok' | 'error' | 'pending'; detail?: string; recovery?: string }) => void } {
  const events: Array<{ step: string; status: 'ok' | 'error' | 'pending'; detail?: string; recovery?: string }> = [];
  return {
    events,
    emit: (e) => events.push(e),
  };
}

function lastEventForStep(
  events: Array<{ step: string; status: 'ok' | 'error' | 'pending'; detail?: string; recovery?: string }>,
  step: string
) {
  return events.filter((e) => e.step === step).pop();
}

const defaultOpts = {
  ifaceName: 'wg-easy',
  listenPort: 51820,
  ipv4Cidr: '10.8.0.1/24',
  sshUser: 'admin',
  sshPassword: 'admin',
};

describe('bootstrap', () => {
  let routerUpdateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockExec.mockReset();
    mockClose.mockReset();
    routerUpdateMock = vi.fn(async () => ({}));
    (globalThis as unknown as { Database: Record<string, unknown> }).Database = {
      routers: { update: routerUpdateMock },
      interfaces: { getByRouterId: vi.fn(async () => []) },
    };
  });

  it('emits all success events on a green path', async () => {
    setupSshResponses([
      { match: '/system/identity/print', stdout: 'name=RouterOS' },
      { match: '/system/resource/print', stdout: 'version=7.15.0' },
      { match: '/interface/wireguard/print count-only', stdout: '0' },
      { match: '/interface/wireguard/add', stdout: '' },
      { match: '/ip/address/print count-only', stdout: '0' },
      { match: '/ip/address/add', stdout: '' },
      { match: '/ip/firewall/filter/print count-only', stdout: '0' },
      { match: '/ip/firewall/filter/add', stdout: '' },
      { match: '/ip/firewall/nat/print count-only', stdout: '0' },
      { match: '/ip/firewall/nat/add', stdout: '' },
      { match: '/ip/route/print', stdout: 'gateway-status=192.168.1.1,ether1 reachable' },
      { match: '/user/print count-only', stdout: '0' },
      { match: '/user/add', stdout: '' },
      { match: '/ip/service/print count-only', stdout: '0' },
      { match: '/certificate/print count-only', stdout: '1' },
      { match: '/ip/service/set', stdout: '' },
      { match: '/certificate/print as-value', stdout: '.name=api-ssl-cert\n.fingerprint=AB:CD' },
    ]);

    const router = makeRouter();
    const { events, emit } = collectEvents();

    await bootstrap(router, defaultOpts, emit);

    const okSteps = events.filter((e) => e.status === 'ok').map((e) => e.step);
    expect(okSteps).toContain('connect');
    expect(okSteps).toContain('identity');
    expect(okSteps).toContain('wireguard-interface');
    expect(okSteps).toContain('ip-address');
    expect(okSteps).toContain('firewall');
    expect(okSteps).toContain('nat');
    expect(okSteps).toContain('api-user');
    expect(okSteps).toContain('api-ssl');
    expect(okSteps).toContain('fingerprint');
    expect(okSteps).toContain('persist');
    expect(okSteps).toContain('done');

    expect(routerUpdateMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        transport: 'routeros-api',
        port: 8729,
      })
    );
  });

  it('rejects RouterOS < 7', async () => {
    setupSshResponses([
      { match: '/system/identity/print', stdout: 'name=RouterOS' },
      { match: '/system/resource/print', stdout: 'version=6.49.0' },
    ]);

    const router = makeRouter();
    const { events, emit } = collectEvents();

    await bootstrap(router, defaultOpts, emit);

    const identityEvent = lastEventForStep(events, 'identity');
    expect(identityEvent?.status).toBe('error');
    expect(identityEvent?.detail).toContain('RouterOS 6.49.0');
  });

  it('skips existing firewall rule by comment', async () => {
    const commands: string[] = [];
    mockExec.mockImplementation(async (cmd: string) => {
      commands.push(cmd);
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

    const router = makeRouter();
    const { events, emit } = collectEvents();

    await bootstrap(router, defaultOpts, emit);

    const firewallAdd = commands.find((c) => c.includes('/ip/firewall/filter/add'));
    expect(firewallAdd).toBeUndefined();

    const natAdd = commands.find((c) => c.includes('/ip/firewall/nat/add'));
    expect(natAdd).toBeDefined();

    expect(events.filter((e) => e.status === 'error')).toHaveLength(0);
  });

  it('fails when WAN cannot be auto-detected and no override given', async () => {
    setupSshResponses([
      { match: '/system/identity/print', stdout: 'name=RouterOS' },
      { match: '/system/resource/print', stdout: 'version=7.15.0' },
      { match: '/interface/wireguard/print count-only', stdout: '1' },
      { match: '/ip/address/print count-only', stdout: '1' },
      { match: '/ip/firewall/filter/print count-only', stdout: '0' },
      { match: '/ip/firewall/filter/add', stdout: '' },
      { match: '/ip/firewall/nat/print count-only', stdout: '0' },
      { match: '/ip/route/print', stdout: '' },
    ]);

    const router = makeRouter();
    const { events, emit } = collectEvents();

    await bootstrap(router, defaultOpts, emit);

    const natEvent = lastEventForStep(events, 'nat');
    expect(natEvent?.status).toBe('error');
    expect(natEvent?.detail).toContain('auto-detect');
  });
});
