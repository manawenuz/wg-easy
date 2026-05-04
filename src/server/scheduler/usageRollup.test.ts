import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runUsageRollup } from './usageRollup';

const mockDeleteOldUsageSamples = vi.fn(async () => {});

vi.mock('../services/quotaService', () => ({
  quotaService: {
    deleteOldUsageSamples: (...args: unknown[]) => mockDeleteOldUsageSamples(...args),
  },
}));

describe('usageRollup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes samples older than 7 days', async () => {
    await runUsageRollup();

    expect(mockDeleteOldUsageSamples).toHaveBeenCalledTimes(1);

    const cutoff = mockDeleteOldUsageSamples.mock.calls[0][0] as Date;
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    // Allow a small tolerance for test execution time
    expect(now - cutoff.getTime()).toBeGreaterThanOrEqual(sevenDaysMs - 1000);
    expect(now - cutoff.getTime()).toBeLessThanOrEqual(sevenDaysMs + 1000);
  });
});
