import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setSpeedLimit, clearSpeedLimit } from './speedLimitService';

const mockApplySpeedLimit = vi.fn(async () => {});
const mockClearSpeedLimit = vi.fn(async () => {});
const mockEngineCapabilities = { speedLimit: 'engine-native' };

vi.mock('../engines/registry', () => ({
  getEngine: vi.fn(() => ({
    capabilities: mockEngineCapabilities,
    applySpeedLimit: (...args: unknown[]) => mockApplySpeedLimit(...args),
    clearSpeedLimit: (...args: unknown[]) => mockClearSpeedLimit(...args),
  })),
}));

describe('speedLimitService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEngineCapabilities.speedLimit = 'engine-native';

    vi.stubGlobal('Database', {
      clients: {
        get: vi.fn(async (id: number) => {
          if (id === 1) return { id: 1, name: 'client1', publicKey: 'pk1', ipv4Address: '10.0.0.1' };
          if (id === 2) return { id: 2, name: 'client2', publicKey: 'pk2', ipv4Address: '10.0.0.2' };
          return undefined;
        }),
      },
      interfaces: {
        get: vi.fn(async () => ({ name: 'wg0', engineType: 'wireguard' })),
      },
      speedLimits: {
        upsert: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        getByClientId: vi.fn(async () => null),
      },
    });
  });

  it('sets speed limit via engine and upserts DB record', async () => {
    const result = await setSpeedLimit(1, 512, 1024);

    expect(Database.speedLimits.upsert).toHaveBeenCalledWith({ clientId: 1, upKbps: 512, downKbps: 1024 });
    expect(mockApplySpeedLimit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'wg0' }),
      'pk1',
      512,
      1024
    );
    expect(result).toBeNull(); // getByClientId returns null in mock
  });

  it('clears speed limit when both values are zero', async () => {
    const result = await setSpeedLimit(1, 0, 0);

    expect(Database.speedLimits.delete).toHaveBeenCalledWith(1);
    expect(mockClearSpeedLimit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'wg0' }),
      'pk1'
    );
    expect(result).toBeNull();
  });

  it('throws when client not found', async () => {
    await expect(setSpeedLimit(99, 512, 1024)).rejects.toThrow('Client not found');
  });

  it('throws when engine does not support speed limits', async () => {
    mockEngineCapabilities.speedLimit = 'none';

    await expect(setSpeedLimit(1, 512, 1024)).rejects.toThrow('Speed limits are not supported by this engine');
  });

  it('clearSpeedLimit removes limit from engine and database', async () => {
    await clearSpeedLimit(2);

    expect(mockClearSpeedLimit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'wg0' }),
      'pk2'
    );
    expect(Database.speedLimits.delete).toHaveBeenCalledWith(2);
  });

  it('clearSpeedLimit throws when client not found', async () => {
    await expect(clearSpeedLimit(99)).rejects.toThrow('Client not found');
  });
});
