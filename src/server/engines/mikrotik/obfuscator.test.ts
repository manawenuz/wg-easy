import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deployObfuscator, removeObfuscator, generateClientObfuscatorConfig } from './obfuscator';

const mockPrint = vi.fn();
const mockWrite = vi.fn();
const mockSet = vi.fn();
const mockRemove = vi.fn();
const mockExec = vi.fn();

const mockTransport = {
  print: mockPrint,
  write: mockWrite,
  set: mockSet,
  remove: mockRemove,
  exec: mockExec,
};

describe('deployObfuscator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('creates all resources on a fresh router when deployEnabled is true', async () => {
    let containerExists = false;
    mockPrint.mockImplementation(async (path, query) => {
      if (path === '/container') {
        if (query?.status === 'running') return [];
        if (containerExists) return [{ id: '1', '.id': '1' }];
        containerExists = true; // Next time it will "exist"
        return [];
      }
      return [];
    });
    mockWrite.mockResolvedValue({});
    mockExec.mockResolvedValue({});

    const result = await deployObfuscator(mockTransport as any, {
      ifaceName: 'wg-easy',
      listenPort: 51830,
      wgTargetPort: 51820,
      deployEnabled: true,
    });

    expect(result.listenPort).toBe(51830);
    expect(result.deployEnabled).toBe(true);

    expect(mockWrite).toHaveBeenCalledWith('/interface/veth', expect.any(Object));
    expect(mockWrite).toHaveBeenCalledWith('/ip/address', expect.any(Object));
    expect(mockWrite).toHaveBeenCalledWith('/container/mounts', expect.any(Object));
    expect(mockWrite).toHaveBeenCalledWith('/container', expect.any(Object));
    expect(mockExec).toHaveBeenCalledWith('/file', 'add', expect.any(Object));
    expect(mockExec).toHaveBeenCalledWith('/container', 'start', expect.any(Object));
    expect(mockWrite).toHaveBeenCalledWith('/ip/firewall/nat', expect.any(Object));
  });

  it('skips deployment when deployEnabled is false', async () => {
    const result = await deployObfuscator(mockTransport as any, {
      ifaceName: 'wg-easy',
      listenPort: 51830,
      wgTargetPort: 51820,
      deployEnabled: false,
    });

    expect(result.deployEnabled).toBe(false);
    expect(mockPrint).not.toHaveBeenCalled();
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('skips existing resources on idempotent re-run', async () => {
    mockPrint.mockImplementation(async (path, query) => {
      if (path === '/container' && query?.status === 'running') return [{ id: '1', status: 'running' }];
      return [{ id: '1', name: 'veth-wg-ob' }];
    });

    await deployObfuscator(mockTransport as any, {
      ifaceName: 'wg-easy',
      listenPort: 51830,
      wgTargetPort: 51820,
      deployEnabled: true,
    });

    expect(mockWrite).not.toHaveBeenCalled();
  });
});

describe('removeObfuscator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('removes all obfuscator resources', async () => {
    mockPrint.mockResolvedValue([{ id: '*1', '.id': '*1' }]);
    mockRemove.mockResolvedValue({});

    await removeObfuscator(mockTransport as any);

    expect(mockRemove).toHaveBeenCalledWith('/container', '*1');
    expect(mockRemove).toHaveBeenCalledWith('/interface/veth', '*1');
    expect(mockRemove).toHaveBeenCalledWith('/file', expect.any(String));
  });

  it('is idempotent when nothing exists', async () => {
    mockPrint.mockResolvedValue([]);

    await removeObfuscator(mockTransport as any);

    expect(mockRemove).not.toHaveBeenCalled();
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
      deployEnabled: true,
    });

    expect(config).toContain('router.example.com:51830');
    expect(config).toContain('test-key-123');
    expect(config).toContain('source-lport = 51830');
  });
});
