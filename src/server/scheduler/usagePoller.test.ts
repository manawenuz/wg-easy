import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runUsagePoller } from './usagePoller';

const mockSampleUsage = vi.fn(async () => []);

vi.mock('../engines/registry', () => ({
  getEngine: vi.fn(() => ({
    sampleUsage: (...args: unknown[]) => mockSampleUsage(...args),
  })),
}));

const mockGetLastUsageSample = vi.fn(async () => null);
const mockInsertUsageSample = vi.fn(async () => {});
const mockGetForUser = vi.fn(async () => null);
const mockAddBytes = vi.fn(async () => {});

vi.mock('../services/quotaService', () => ({
  quotaService: {
    getLastUsageSample: (...args: unknown[]) => mockGetLastUsageSample(...args),
    insertUsageSample: (...args: unknown[]) => mockInsertUsageSample(...args),
    getForUser: (...args: unknown[]) => mockGetForUser(...args),
    addBytes: (...args: unknown[]) => mockAddBytes(...args),
  },
}));

describe('usagePoller', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.stubGlobal('Database', {
      interfaces: {
        get: vi.fn(async () => ({ name: 'wg0', engineType: 'wireguard' })),
      },
      clients: {
        getAll: vi.fn(async () => [
          { id: 1, publicKey: 'pk1', name: 'client1', userId: 10 },
          { id: 2, publicKey: 'pk2', name: 'client2', userId: 20 },
        ]),
      },
    });
  });

  it('computes correct deltas and increments user quota', async () => {
    mockSampleUsage.mockResolvedValueOnce([
      { publicKey: 'pk1', rxBytes: 1000n, txBytes: 500n },
    ]);

    mockGetLastUsageSample.mockResolvedValueOnce({
      clientId: 1,
      rxBytes: 400,
      txBytes: 100,
      ts: new Date(),
    });

    mockGetForUser.mockResolvedValueOnce({
      userId: 10,
      limitBytes: 10000,
      usedBytes: 0,
      period: 'daily',
    });

    await runUsagePoller();

    expect(mockInsertUsageSample).toHaveBeenCalledTimes(1);
    expect(mockInsertUsageSample).toHaveBeenCalledWith(1, 1000, 500);

    expect(mockAddBytes).toHaveBeenCalledTimes(1);
    // rxDelta = 1000 - 400 = 600, txDelta = 500 - 100 = 400, total = 1000
    expect(mockAddBytes).toHaveBeenCalledWith(10, 1000);
  });

  it('treats new sample as absolute when counter resets (delta < 0)', async () => {
    mockSampleUsage.mockResolvedValueOnce([
      { publicKey: 'pk1', rxBytes: 200n, txBytes: 50n },
    ]);

    mockGetLastUsageSample.mockResolvedValueOnce({
      clientId: 1,
      rxBytes: 1000,
      txBytes: 500,
      ts: new Date(),
    });

    mockGetForUser.mockResolvedValueOnce({
      userId: 10,
      limitBytes: 10000,
      usedBytes: 0,
      period: 'daily',
    });

    await runUsagePoller();

    expect(mockAddBytes).toHaveBeenCalledTimes(1);
    // rxDelta = 200 (counter reset), txDelta = 50 (counter reset)
    expect(mockAddBytes).toHaveBeenCalledWith(10, 250);
  });

  it('skips clients not found in database', async () => {
    mockSampleUsage.mockResolvedValueOnce([
      { publicKey: 'pk-unknown', rxBytes: 1000n, txBytes: 500n },
    ]);

    await runUsagePoller();

    expect(mockInsertUsageSample).not.toHaveBeenCalled();
    expect(mockAddBytes).not.toHaveBeenCalled();
  });

  it('uses full sample values when no previous sample exists', async () => {
    mockSampleUsage.mockResolvedValueOnce([
      { publicKey: 'pk1', rxBytes: 5000n, txBytes: 3000n },
    ]);

    mockGetLastUsageSample.mockResolvedValueOnce(null);

    mockGetForUser.mockResolvedValueOnce({
      userId: 10,
      limitBytes: 100000,
      usedBytes: 0,
      period: 'daily',
    });

    await runUsagePoller();

    expect(mockInsertUsageSample).toHaveBeenCalledWith(1, 5000, 3000);
    expect(mockAddBytes).toHaveBeenCalledWith(10, 8000);
  });

  it('does not insert or add usage when delta is zero', async () => {
    mockSampleUsage.mockResolvedValueOnce([
      { publicKey: 'pk1', rxBytes: 1000n, txBytes: 500n },
    ]);

    mockGetLastUsageSample.mockResolvedValueOnce({
      clientId: 1,
      rxBytes: 1000,
      txBytes: 500,
      ts: new Date(),
    });

    await runUsagePoller();

    expect(mockInsertUsageSample).not.toHaveBeenCalled();
    expect(mockAddBytes).not.toHaveBeenCalled();
  });

  it('only adds usage when user has a quota', async () => {
    mockSampleUsage.mockResolvedValueOnce([
      { publicKey: 'pk1', rxBytes: 1000n, txBytes: 500n },
    ]);

    mockGetLastUsageSample.mockResolvedValueOnce(null);
    mockGetForUser.mockResolvedValueOnce(null);

    await runUsagePoller();

    expect(mockInsertUsageSample).toHaveBeenCalledTimes(1);
    expect(mockAddBytes).not.toHaveBeenCalled();
  });
});
