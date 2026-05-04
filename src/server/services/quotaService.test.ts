import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuotaService } from './quotaService';

describe('QuotaService', () => {
  let service: QuotaService;

  beforeEach(() => {
    service = new QuotaService();

    vi.clearAllMocks();
    vi.stubGlobal('Database', {
      quotas: {
        getByClientId: vi.fn(async (id: number) => {
          if (id === 1) {
            return {
              clientId: 1,
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
      usageSamples: {
        insert: vi.fn(async () => {}),
        lastForClient: vi.fn(async () => null),
        deleteOlderThan: vi.fn(async () => {}),
      },
    });
  });

  it('getQuota returns existing quota', async () => {
    const result = await service.getQuota(1);
    expect(result).toEqual(expect.objectContaining({ clientId: 1, limitBytes: 1073741824 }));
    expect(Database.quotas.getByClientId).toHaveBeenCalledWith(1);
  });

  it('getQuota returns undefined when no quota', async () => {
    const result = await service.getQuota(99);
    expect(result).toBeUndefined();
  });

  it('setQuota creates new quota when none exists', async () => {
    await service.setQuota(2, { limitBytes: 1000000, period: 'weekly' });

    expect(Database.quotas.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 2,
        limitBytes: 1000000,
        period: 'weekly',
        autoDisable: true,
        periodStart: expect.any(Date),
        periodEnd: expect.any(Date),
      })
    );
  });

  it('setQuota updates existing quota', async () => {
    await service.setQuota(1, { limitBytes: 2000000, period: 'monthly', autoDisable: false });

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

  it('deleteQuota removes quota', async () => {
    await service.deleteQuota(1);
    expect(Database.quotas.delete).toHaveBeenCalledWith(1);
  });

  it('addUsage adds total bytes to quota', async () => {
    await service.addUsage(1, 100, 200);
    expect(Database.quotas.addUsage).toHaveBeenCalledWith(1, 300);
  });

  it('addUsage skips when total is zero or negative', async () => {
    await service.addUsage(1, 0, 0);
    expect(Database.quotas.addUsage).not.toHaveBeenCalled();

    await service.addUsage(1, -10, 5);
    expect(Database.quotas.addUsage).not.toHaveBeenCalled();
  });

  it('findOverLimit delegates to repository', async () => {
    await service.findOverLimit();
    expect(Database.quotas.findOverLimit).toHaveBeenCalled();
  });

  it('findExpiredPeriods delegates to repository', async () => {
    await service.findExpiredPeriods();
    expect(Database.quotas.findExpiredPeriods).toHaveBeenCalled();
  });

  it('resetPeriod updates usedBytes to 0 and computes new period dates', async () => {
    await service.resetPeriod({ clientId: 1, period: 'daily' });

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

  it('markDisabledByQuota delegates to repository', async () => {
    await service.markDisabledByQuota(1);
    expect(Database.quotas.markDisabledByQuota).toHaveBeenCalledWith(1);
  });

  it('clearDisabledByQuota delegates to repository', async () => {
    await service.clearDisabledByQuota(1);
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

  it('computes correct period dates for daily', async () => {
    await service.setQuota(2, { limitBytes: 1000, period: 'daily' });
    const call = Database.quotas.create.mock.calls[0][0];
    const oneDayMs = 24 * 60 * 60 * 1000;
    expect(call.periodEnd.getTime() - call.periodStart.getTime()).toBe(oneDayMs);
  });

  it('computes correct period dates for weekly', async () => {
    await service.setQuota(2, { limitBytes: 1000, period: 'weekly' });
    const call = Database.quotas.create.mock.calls[0][0];
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(call.periodEnd.getTime() - call.periodStart.getTime()).toBe(sevenDaysMs);
    expect(call.periodStart.getDay()).toBe(0); // Sunday
  });

  it('computes correct period dates for monthly', async () => {
    await service.setQuota(2, { limitBytes: 1000, period: 'monthly' });
    const call = Database.quotas.create.mock.calls[0][0];
    expect(call.periodStart.getDate()).toBe(1);
    expect(call.periodEnd.getDate()).toBe(1);
    // periodEnd should be the first day of next month
    expect(call.periodEnd.getTime() - call.periodStart.getTime()).toBeGreaterThan(27 * 24 * 60 * 60 * 1000);
  });
});
