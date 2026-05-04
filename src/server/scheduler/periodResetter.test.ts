import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPeriodResetter } from './periodResetter';

const mockEnablePeer = vi.fn(async () => {});

vi.mock('../engines/registry', () => ({
  getEngine: vi.fn(() => ({
    enablePeer: (...args: unknown[]) => mockEnablePeer(...args),
  })),
}));

const mockFindExpiredPeriods = vi.fn(async () => []);
const mockResetPeriod = vi.fn(async () => {});

vi.mock('../services/quotaService', () => ({
  quotaService: {
    findExpiredPeriods: (...args: unknown[]) => mockFindExpiredPeriods(...args),
    resetPeriod: (...args: unknown[]) => mockResetPeriod(...args),
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
        get: vi.fn(async (clientId: number) => ({
          id: clientId,
          publicKey: `pk${clientId}`,
          enabled: true,
          name: `client${clientId}`,
        })),
        toggle: vi.fn(async () => {}),
      },
      auditLogs: {
        getAllPaginated: vi.fn(async () => ({ items: [], total: 0 })),
        create: vi.fn(async () => {}),
      },
    });
  });

  it('resets expired periods', async () => {
    mockFindExpiredPeriods.mockResolvedValueOnce([
      {
        clientId: 1,
        period: 'daily',
        disabledByQuotaAt: null,
      },
    ]);

    await runPeriodResetter();

    expect(mockResetPeriod).toHaveBeenCalledTimes(1);
    expect(mockResetPeriod).toHaveBeenCalledWith({ clientId: 1, period: 'daily' });
    expect(mockEnablePeer).not.toHaveBeenCalled();
  });

  it('re-enables peer when quota disabled it and no manual disable since', async () => {
    const disabledAt = new Date(Date.now() - 3600_000);
    mockFindExpiredPeriods.mockResolvedValueOnce([
      {
        clientId: 1,
        period: 'daily',
        disabledByQuotaAt: disabledAt,
      },
    ]);

    await runPeriodResetter();

    expect(mockResetPeriod).toHaveBeenCalledTimes(1);
    expect(Database.clients.toggle).toHaveBeenCalledTimes(1);
    expect(Database.clients.toggle).toHaveBeenCalledWith(1, true);
    expect(mockEnablePeer).toHaveBeenCalledTimes(1);
    expect(mockEnablePeer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'wg0' }),
      'pk1'
    );
    expect(Database.auditLogs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'quota.periodReset',
        target: expect.objectContaining({ clientId: 1 }),
        result: 'ok',
      })
    );
  });

  it('does not re-enable peer if manually disabled after quota disable', async () => {
    const disabledAt = new Date(Date.now() - 3600_000);
    mockFindExpiredPeriods.mockResolvedValueOnce([
      {
        clientId: 1,
        period: 'daily',
        disabledByQuotaAt: disabledAt,
      },
    ]);

    vi.stubGlobal('Database', {
      interfaces: {
        get: vi.fn(async () => ({ name: 'wg0', engineType: 'wireguard' })),
      },
      clients: {
        get: vi.fn(async (clientId: number) => ({
          id: clientId,
          publicKey: `pk${clientId}`,
          enabled: false,
          name: `client${clientId}`,
        })),
        toggle: vi.fn(async () => {}),
      },
      auditLogs: {
        getAllPaginated: vi.fn(async () => ({
          items: [
            {
              action: 'client.disabled',
              target: JSON.stringify({ clientId: 1 }),
              createdAt: new Date(disabledAt.getTime() + 1000),
            },
          ],
          total: 1,
        })),
        create: vi.fn(async () => {}),
      },
    });

    await runPeriodResetter();

    expect(mockResetPeriod).toHaveBeenCalledTimes(1);
    expect(mockEnablePeer).not.toHaveBeenCalled();
  });

  it('logs error when engine enablePeer fails', async () => {
    const disabledAt = new Date(Date.now() - 3600_000);
    mockFindExpiredPeriods.mockResolvedValueOnce([
      {
        clientId: 2,
        period: 'weekly',
        disabledByQuotaAt: disabledAt,
      },
    ]);

    mockEnablePeer.mockRejectedValueOnce(new Error('wg command failed'));

    await runPeriodResetter();

    expect(mockEnablePeer).toHaveBeenCalledTimes(1);
    expect(Database.auditLogs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'quota.periodReset',
        target: expect.objectContaining({ clientId: 2, error: 'wg command failed' }),
        result: 'error',
      })
    );
  });

  it('handles weekly and monthly periods', async () => {
    mockFindExpiredPeriods.mockResolvedValueOnce([
      { clientId: 1, period: 'weekly', disabledByQuotaAt: null },
      { clientId: 2, period: 'monthly', disabledByQuotaAt: null },
    ]);

    await runPeriodResetter();

    expect(mockResetPeriod).toHaveBeenCalledTimes(2);
    expect(mockResetPeriod).toHaveBeenNthCalledWith(1, { clientId: 1, period: 'weekly' });
    expect(mockResetPeriod).toHaveBeenNthCalledWith(2, { clientId: 2, period: 'monthly' });
  });
});
