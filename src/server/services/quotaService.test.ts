import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuotaService } from './quotaService';

describe('QuotaService', () => {
  let service: QuotaService;

  beforeEach(() => {
    service = new QuotaService();

    vi.clearAllMocks();
    vi.stubGlobal('Database', {
      quotas: {
        getByUserId: vi.fn(async (id: number) => {
          if (id === 1) {
            return {
              userId: 1,
              limitBytes: 1073741824,
              usedBytes: 100,
              period: 'daily',
              periodStart: new Date('2026-01-01'),
              periodEnd: new Date('2026-01-02'),
              autoDisable: true,
              disabledByQuotaAt: null,
            };
          }
          return undefined;
        }),
        create: vi.fn(async () => {}),
        update: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        addUsage: vi.fn(async () => {}),
        findOverLimit: vi.fn(async () => []),
        findExpiredPeriods: vi.fn(async () => []),
        markDisabledByQuota: vi.fn(async () => {}),
        clearDisabledByQuota: vi.fn(async () => {}),
      },
      users: {
        get: vi.fn(async (id: number) => {
          if (id === 1) return { id: 1, defaultTrafficGroupId: null };
          return null;
        }),
        getRootUserId: vi.fn(async (id: number) => {
          if (id === 2) return 1; // sub-account 2 → root 1
          return id;
        }),
      },
      trafficGroups: {
        get: vi.fn(async () => null),
        getDefault: vi.fn(async () => null),
      },
      usageSamples: {
        insert: vi.fn(async () => {}),
        lastForClient: vi.fn(async () => null),
        deleteOlderThan: vi.fn(async () => {}),
      },
    });
  });

  it('getForUser returns existing quota', async () => {
    const result = await service.getForUser(1);
    expect(result).toEqual(expect.objectContaining({ userId: 1, limitBytes: 1073741824 }));
    expect(Database.quotas.getByUserId).toHaveBeenCalledWith(1);
  });

  it('getForUser resolves root for sub-account', async () => {
    const result = await service.getForUser(2);
    expect(result).toEqual(expect.objectContaining({ userId: 1, limitBytes: 1073741824 }));
    expect(Database.quotas.getByUserId).toHaveBeenCalledWith(1);
    expect(Database.users.getRootUserId).toHaveBeenCalledWith(2);
  });

  it('getForUser returns null when no quota', async () => {
    const result = await service.getForUser(99);
    expect(result).toBeNull();
  });

  it('setForUser creates new quota on root user', async () => {
    await service.setForUser(3, { limitBytes: 1000000, period: 'weekly' });

    expect(Database.quotas.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 3,
        limitBytes: 1000000,
        period: 'weekly',
        autoDisable: true,
        periodStart: expect.any(Date),
        periodEnd: expect.any(Date),
      })
    );
  });

  it('setForUser updates existing root quota', async () => {
    await service.setForUser(1, { limitBytes: 2000000, period: 'monthly', autoDisable: false });

    expect(Database.quotas.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        limitBytes: 2000000,
        period: 'monthly',
        autoDisable: false,
        periodStart: expect.any(Date),
        periodEnd: expect.any(Date),
      })
    );
    expect(Database.quotas.create).not.toHaveBeenCalled();
  });

  it('clearForUser removes root quota', async () => {
    await service.clearForUser(2);
    expect(Database.quotas.delete).toHaveBeenCalledWith(1);
  });

  it('addBytes routes sub-account to root bucket', async () => {
    await service.addBytes(2, 300);
    expect(Database.quotas.addUsage).toHaveBeenCalledWith(1, 300);
  });

  it('addBytes skips when total is zero or negative', async () => {
    await service.addBytes(1, 0);
    expect(Database.quotas.addUsage).not.toHaveBeenCalled();

    await service.addBytes(1, -10);
    expect(Database.quotas.addUsage).not.toHaveBeenCalled();
  });

  it('findExpiredPeriods delegates to repository', async () => {
    await service.findExpiredPeriods();
    expect(Database.quotas.findExpiredPeriods).toHaveBeenCalled();
  });

  it('evaluateAll delegates to repository', async () => {
    await service.evaluateAll();
    expect(Database.quotas.findOverLimit).toHaveBeenCalled();
  });

  it('evaluateAll returns over-limit root users', async () => {
    vi.stubGlobal('Database', {
      ...Database,
      quotas: {
        ...Database.quotas,
        findOverLimit: vi.fn(async () => [
          { userId: 1, limitBytes: 1000, usedBytes: 1500, period: 'daily', autoDisable: true, disabledByQuotaAt: null },
        ]),
      },
    });

    const result = await service.evaluateAll();
    expect(result).toEqual([
      { userId: 1, overLimit: true, autoDisable: true, usedBytes: 1500, limitBytes: 1000 },
    ]);
  });

  it('resetPeriodIfNeeded returns false when period has not expired', async () => {
    const now = new Date('2026-01-01T12:00:00');
    const result = await service.resetPeriodIfNeeded(1, now);
    expect(result).toBe(false);
  });

  it('resetPeriodIfNeeded resets when period expired', async () => {
    const now = new Date('2026-01-03T00:00:00');
    const result = await service.resetPeriodIfNeeded(1, now);
    expect(result).toBe(true);
    expect(Database.quotas.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        usedBytes: 0,
        disabledByQuotaAt: null,
        periodStart: expect.any(Date),
        periodEnd: expect.any(Date),
      })
    );
  });

  it('resetPeriodIfNeeded resolves root for sub-account', async () => {
    const now = new Date('2026-01-03T00:00:00');
    await service.resetPeriodIfNeeded(2, now);
    expect(Database.quotas.update).toHaveBeenCalledWith(
      1,
      expect.any(Object)
    );
  });

  it('markDisabledByQuota resolves root', async () => {
    await service.markDisabledByQuota(2);
    expect(Database.quotas.markDisabledByQuota).toHaveBeenCalledWith(1);
  });

  it('clearDisabledByQuota resolves root', async () => {
    await service.clearDisabledByQuota(2);
    expect(Database.quotas.clearDisabledByQuota).toHaveBeenCalledWith(1);
  });

  it('insertUsageSample delegates to repository', async () => {
    const ts = new Date();
    await service.insertUsageSample(1, 100, 200, ts);
    expect(Database.usageSamples.insert).toHaveBeenCalledWith({ clientId: 1, rxBytes: 100, txBytes: 200, ts });
  });

  it('getLastUsageSample delegates to repository', async () => {
    await service.getLastUsageSample(1);
    expect(Database.usageSamples.lastForClient).toHaveBeenCalledWith(1);
  });

  it('deleteOldUsageSamples delegates to repository', async () => {
    const cutoff = new Date('2026-01-01');
    await service.deleteOldUsageSamples(cutoff);
    expect(Database.usageSamples.deleteOlderThan).toHaveBeenCalledWith(cutoff);
  });
});
