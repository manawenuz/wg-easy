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
const mockGetQuota = vi.fn(async () => null);
const mockAddUsage = vi.fn(async () => {});

vi.mock('../services/quotaService', () => ({
  quotaService: {
    getLastUsageSample: (...args: unknown[]) => mockGetLastUsageSample(...args),
    insertUsageSample: (...args: unknown[]) => mockInsertUsageSample(...args),
    getQuota: (...args: unknown[]) => mockGetQuota(...args),
    addUsage: (...args: unknown[]) => mockAddUsage(...args),
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
          { id: 1, publicKey: 'pk1', name: 'client1' },
          { id: 2, publicKey: 'pk2', name: 'client2' },
        ]),
      },
    });
  });

  it('computes correct deltas and increments quota', async () => {
    mockSampleUsage.mockResolvedValueOnce([
      { publicKey: 'pk1', rxBytes: 1000n, txBytes: 500n },
    ]);

    mockGetLastUsageSample.mockResolvedValueOnce({
      clientId: 1,
      rxBytes: 400,
      txBytes: 100,
      ts: new Date(),
    });

    mockGetQuota.mockResolvedValueOnce({
      clientId: 1,
      limitBytes: 10000,
      usedBytes: 0,
      period: 'daily',
    });

    await runUsagePoller();

    expect(mockInsertUsageSample).toHaveBeenCalledTimes(1);
    expect(mockInsertUsageSample).toHaveBeenCalledWith(1, 1000, 500);

    expect(mockAddUsage).toHaveBeenCalledTimes(1);
    // rxDelta = 1000 - 400 = 600, txDelta = 500 - 100 = 400, total = 1000
    expect(mockAddUsage).toHaveBeenCalledWith(1, 600, 400);
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

    mockGetQuota.mockResolvedValueOnce({
      clientId: 1,
      limitBytes: 10000,
      usedBytes: 0,
      period: 'daily',
    });

    await runUsagePoller();

    expect(mockAddUsage).toHaveBeenCalledTimes(1);
    // rxDelta = 200 (counter reset), txDelta = 50 (counter reset)
    expect(mockAddUsage).toHaveBeenCalledWith(1, 200, 50);
  });

  it('skips clients not found in database', async () => {
    mockSampleUsage.mockResolvedValueOnce([
      { publicKey: 'pk-unknown', rxBytes: 1000n, txBytes: 500n },
    ]);

    await runUsagePoller();

    expect(mockInsertUsageSample).not.toHaveBeenCalled();
    expect(mockAddUsage).not.toHaveBeenCalled();
  });

  it('uses full sample values when no previous sample exists', async () => {
    mockSampleUsage.mockResolvedValueOnce([
      { publicKey: 'pk1', rxBytes: 5000n, txBytes: 3000n },
    ]);

    mockGetLastUsageSample.mockResolvedValueOnce(null);

    mockGetQuota.mockResolvedValueOnce({
      clientId: 1,
      limitBytes: 100000,
      usedBytes: 0,
      period: 'daily',
    });

    await runUsagePoller();

    expect(mockInsertUsageSample).toHaveBeenCalledWith(1, 5000, 3000);
    expect(mockAddUsage).toHaveBeenCalledWith(1, 5000, 3000);
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
    expect(mockAddUsage).not.toHaveBeenCalled();
  });

  it('only adds usage when client has a quota', async () => {
    mockSampleUsage.mockResolvedValueOnce([
      { publicKey: 'pk1', rxBytes: 1000n, txBytes: 500n },
    ]);

    mockGetLastUsageSample.mockResolvedValueOnce(null);
    mockGetQuota.mockResolvedValueOnce(null);

    await runUsagePoller();

    expect(mockInsertUsageSample).toHaveBeenCalledTimes(1);
    expect(mockAddUsage).not.toHaveBeenCalled();
  });
});
