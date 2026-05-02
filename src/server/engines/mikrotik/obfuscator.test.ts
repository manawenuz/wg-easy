import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deployObfuscator, removeObfuscator, generateClientObfuscatorConfig } from './obfuscator';
import type { RouterType } from '#db/repositories/router/types';

const mockExec = vi.fn();
const mockClose = vi.fn();

vi.mock('../../transports/ssh', () => {
  return {
    SshTransport: class MockSshTransport {
      exec = mockExec;
      close = mockClose;
    },
  };
});

function makeRouter(overrides: Partial<RouterType> = {}): RouterType {
  return {
    id: 1,
    name: 'test-router',
    engineType: 'mikrotik',
    transport: 'routeros-api',
    host: '192.168.1.1',
    port: 8729,
    credentialsEncrypted: null,
    enabled: true,
    lastSeen: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('deployObfuscator', () => {
  beforeEach(() => {
    mockExec.mockReset();
    mockClose.mockReset();
  });

  it('creates all resources on a fresh router', async () => {
    const commands: string[] = [];
    mockExec.mockImplementation(async (cmd: string) => {
      commands.push(cmd);
      if (cmd.includes('/interface/veth/print count-only')) return { stdout: '0', stderr: '', code: 0 };
      if (cmd.includes('/ip/address/print count-only')) return { stdout: '0', stderr: '', code: 0 };
      if (cmd.includes('/container/mounts/print count-only')) return { stdout: '0', stderr: '', code: 0 };
      if (cmd.includes('/container/print count-only where name')) return { stdout: '0', stderr: '', code: 0 };
      if (cmd.includes('/container/print count-only where name') && cmd.includes('status')) return { stdout: '0', stderr: '', code: 0 };
      if (cmd.includes('/ip/firewall/nat/print count-only')) return { stdout: '0', stderr: '', code: 0 };
      if (cmd.includes('/file/print count-only')) return { stdout: '0', stderr: '', code: 0 };
      return { stdout: '', stderr: '', code: 0 };
    });

    const router = makeRouter();
    const result = await deployObfuscator(router, {
      ifaceName: 'wg-easy',
      listenPort: 51830,
      wgTargetPort: 51820,
    });

    expect(result.listenPort).toBe(51830);
    expect(result.wgTargetPort).toBe(51820);
    expect(result.interfaceId).toBe('wg-easy');
    expect(result.key).toBeDefined();
    expect(result.key.length).toBeGreaterThan(0);

    expect(commands.some((c) => c.includes('/interface/veth/add'))).toBe(true);
    expect(commands.some((c) => c.includes('/ip/address/add'))).toBe(true);
    expect(commands.some((c) => c.includes('/container/mounts/add'))).toBe(true);
    expect(commands.some((c) => c.includes('/container/add'))).toBe(true);
    expect(commands.some((c) => c.includes('/container/start'))).toBe(true);
    expect(commands.some((c) => c.includes('/ip/firewall/nat/add'))).toBe(true);
  });

  it('skips existing resources on idempotent re-run', async () => {
    const commands: string[] = [];
    mockExec.mockImplementation(async (cmd: string) => {
      commands.push(cmd);
      if (cmd.includes('/interface/veth/print count-only')) return { stdout: '1', stderr: '', code: 0 };
      if (cmd.includes('/ip/address/print count-only')) return { stdout: '1', stderr: '', code: 0 };
      if (cmd.includes('/container/mounts/print count-only')) return { stdout: '1', stderr: '', code: 0 };
      if (cmd.includes('/container/print count-only where name') && cmd.includes('status')) return { stdout: '1', stderr: '', code: 0 };
      if (cmd.includes('/container/print count-only where name="wg-obfuscator"')) return { stdout: '1', stderr: '', code: 0 };
      if (cmd.includes('/ip/firewall/nat/print count-only')) return { stdout: '1', stderr: '', code: 0 };
      if (cmd.includes('/file/print count-only')) return { stdout: '1', stderr: '', code: 0 };
      return { stdout: '', stderr: '', code: 0 };
    });

    const router = makeRouter();
    await deployObfuscator(router, {
      ifaceName: 'wg-easy',
      listenPort: 51830,
      wgTargetPort: 51820,
    });

    expect(commands.some((c) => c.includes('/interface/veth/add'))).toBe(false);
    expect(commands.some((c) => c.includes('/container/add'))).toBe(false);
    expect(commands.some((c) => c.includes('/ip/firewall/nat/add'))).toBe(false);
  });
});

describe('removeObfuscator', () => {
  beforeEach(() => {
    mockExec.mockReset();
    mockClose.mockReset();
  });

  it('removes all obfuscator resources', async () => {
    const commands: string[] = [];
    mockExec.mockImplementation(async (cmd: string) => {
      commands.push(cmd);
      if (cmd.includes('/container/print count-only')) return { stdout: '1', stderr: '', code: 0 };
      if (cmd.includes('/container/mounts/print count-only')) return { stdout: '1', stderr: '', code: 0 };
      if (cmd.includes('/ip/firewall/nat/print count-only')) return { stdout: '1', stderr: '', code: 0 };
      if (cmd.includes('/interface/veth/print count-only')) return { stdout: '1', stderr: '', code: 0 };
      if (cmd.includes('/file/print count-only')) return { stdout: '1', stderr: '', code: 0 };
      return { stdout: '', stderr: '', code: 0 };
    });

    const router = makeRouter();
    await removeObfuscator(router);

    expect(commands.some((c) => c.includes('/container/stop'))).toBe(true);
    expect(commands.some((c) => c.includes('/container/remove'))).toBe(true);
    expect(commands.some((c) => c.includes('/container/mounts/remove'))).toBe(true);
    expect(commands.some((c) => c.includes('/ip/firewall/nat/remove'))).toBe(true);
    expect(commands.some((c) => c.includes('/interface/veth/remove'))).toBe(true);
    expect(commands.some((c) => c.includes('/file/remove'))).toBe(true);
  });

  it('is idempotent when nothing exists', async () => {
    const commands: string[] = [];
    mockExec.mockImplementation(async (cmd: string) => {
      commands.push(cmd);
      if (cmd.includes('/container/print count-only')) return { stdout: '0', stderr: '', code: 0 };
      if (cmd.includes('/container/mounts/print count-only')) return { stdout: '0', stderr: '', code: 0 };
      if (cmd.includes('/ip/firewall/nat/print count-only')) return { stdout: '0', stderr: '', code: 0 };
      if (cmd.includes('/interface/veth/print count-only')) return { stdout: '0', stderr: '', code: 0 };
      if (cmd.includes('/file/print count-only')) return { stdout: '0', stderr: '', code: 0 };
      return { stdout: '', stderr: '', code: 0 };
    });

    const router = makeRouter();
    await removeObfuscator(router);

    expect(commands.some((c) => c.includes('/container/remove'))).toBe(false);
    expect(commands.some((c) => c.includes('/interface/veth/remove'))).toBe(false);
  });
});

describe('generateClientObfuscatorConfig', () => {
  it('generates a valid client config snippet', () => {
    const config = generateClientObfuscatorConfig('router.example.com', {
      interfaceId: 'wg-easy',
      listenPort: 51830,
      wgTargetPort: 51820,
      key: 'test-key-123',
      dummyPaddingMin: 8,
      dummyPaddingMax: 64,
    });

    expect(config).toContain('router.example.com:51830');
    expect(config).toContain('test-key-123');
    expect(config).toContain('source-lport = 51830');
  });
});
