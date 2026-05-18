import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPeriodResetter } from './periodResetter';

const mockFindExpiredPeriods = vi.fn(async () => []);
const mockResetPeriodIfNeeded = vi.fn(async () => false);
const mockAuditLogsCreate = vi.fn(async () => {});

vi.mock('../services/quotaService', () => ({
  quotaService: {
    findExpiredPeriods: (...args: unknown[]) => mockFindExpiredPeriods(...args),
    resetPeriodIfNeeded: (...args: unknown[]) => mockResetPeriodIfNeeded(...args),
  },
}));

describe('periodResetter', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.stubGlobal('Database', {
      interfaces: {
        get: vi.fn(async () => ({ name: 'wg0', engineType: 'wireguard' })),
      },
      clients: {
        get: vi.fn(async () => ({ id: 1, publicKey: 'pk1', enabled: true, name: 'client1' })),
        toggle: vi.fn(async () => {}),
      },
      auditLogs: {
        getAllPaginated: vi.fn(async () => ({ items: [], total: 0 })),
        create: mockAuditLogsCreate,
      },
    });
  });

  it('resets expired periods', async () => {
    mockFindExpiredPeriods.mockResolvedValueOnce([
      {
        userId: 1,
        period: 'daily',
        disabledByQuotaAt: null,
      },
    ]);
    mockResetPeriodIfNeeded.mockResolvedValueOnce(true);

    await runPeriodResetter();

    expect(mockResetPeriodIfNeeded).toHaveBeenCalledTimes(1);
    expect(mockResetPeriodIfNeeded).toHaveBeenCalledWith(1, expect.any(Date));
    expect(mockAuditLogsCreate).not.toHaveBeenCalled();
  });

  it('creates audit log when quota-disabled user gets reset', async () => {
    const disabledAt = new Date(Date.now() - 3600_000);
    mockFindExpiredPeriods.mockResolvedValueOnce([
      {
        userId: 1,
        period: 'daily',
        disabledByQuotaAt: disabledAt,
      },
    ]);
    mockResetPeriodIfNeeded.mockResolvedValueOnce(true);

    await runPeriodResetter();

    expect(mockResetPeriodIfNeeded).toHaveBeenCalledTimes(1);
    expect(mockAuditLogsCreate).toHaveBeenCalledTimes(1);
    expect(mockAuditLogsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'quota.periodReset',
        target: expect.objectContaining({ userId: 1 }),
        result: 'ok',
      })
    );
  });

  it('does not re-enable peers after reset', async () => {
    const disabledAt = new Date(Date.now() - 3600_000);
    mockFindExpiredPeriods.mockResolvedValueOnce([
      {
        userId: 1,
        period: 'daily',
        disabledByQuotaAt: disabledAt,
      },
    ]);
    mockResetPeriodIfNeeded.mockResolvedValueOnce(true);

    await runPeriodResetter();

    expect(Database.clients.toggle).not.toHaveBeenCalled();
  });

  it('handles weekly and monthly periods', async () => {
    mockFindExpiredPeriods.mockResolvedValueOnce([
      { userId: 1, period: 'weekly', disabledByQuotaAt: null },
      { userId: 2, period: 'monthly', disabledByQuotaAt: null },
    ]);
    mockResetPeriodIfNeeded.mockResolvedValueOnce(true).mockResolvedValueOnce(true);

    await runPeriodResetter();

    expect(mockResetPeriodIfNeeded).toHaveBeenCalledTimes(2);
    expect(mockResetPeriodIfNeeded).toHaveBeenNthCalledWith(1, 1, expect.any(Date));
    expect(mockResetPeriodIfNeeded).toHaveBeenNthCalledWith(2, 2, expect.any(Date));
  });
});
