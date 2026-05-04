import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runQuotaEvaluator } from './quotaEvaluator';

const mockDisablePeer = vi.fn(async () => {});
const mockMarkDisabledByQuota = vi.fn(async () => {});
const mockAuditLogsCreate = vi.fn(async () => {});
const mockFindOverLimit = vi.fn(async () => []);

vi.mock('../engines/registry', () => ({
  getEngine: vi.fn(() => ({
    disablePeer: (...args: unknown[]) => mockDisablePeer(...args),
  })),
}));

vi.mock('../services/quotaService', () => ({
  quotaService: {
    findOverLimit: (...args: unknown[]) => mockFindOverLimit(...args),
    markDisabledByQuota: (...args: unknown[]) => mockMarkDisabledByQuota(...args),
  },
}));

describe('quotaEvaluator', () => {
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
        create: mockAuditLogsCreate,
      },
    });
  });

  it('disables peer and creates audit log when quota is exceeded', async () => {
    mockFindOverLimit.mockResolvedValueOnce([
      {
        clientId: 1,
        limitBytes: 10 * 1024 * 1024,
        usedBytes: 11 * 1024 * 1024,
        period: 'daily',
        periodStart: new Date(Date.now() - 3600_000),
        periodEnd: new Date(Date.now() + 3600_000),
        autoDisable: true,
        disabledByQuotaAt: null,
      },
    ]);

    await runQuotaEvaluator();

    expect(Database.clients.toggle).toHaveBeenCalledTimes(1);
    expect(Database.clients.toggle).toHaveBeenCalledWith(1, false);
    expect(mockDisablePeer).toHaveBeenCalledTimes(1);
    expect(mockDisablePeer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'wg0' }),
      'pk1'
    );
    expect(mockMarkDisabledByQuota).toHaveBeenCalledTimes(1);
    expect(mockMarkDisabledByQuota).toHaveBeenCalledWith(1);
    expect(mockAuditLogsCreate).toHaveBeenCalledTimes(1);
    expect(mockAuditLogsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'quota.exceeded',
        target: expect.objectContaining({ clientId: 1 }),
        result: 'ok',
      })
    );
  });

  it('skips already disabled clients', async () => {
    mockFindOverLimit.mockResolvedValueOnce([
      {
        clientId: 2,
        limitBytes: 10 * 1024 * 1024,
        usedBytes: 11 * 1024 * 1024,
        period: 'daily',
        periodStart: new Date(Date.now() - 3600_000),
        periodEnd: new Date(Date.now() + 3600_000),
        autoDisable: true,
        disabledByQuotaAt: null,
      },
    ]);

    vi.stubGlobal('Database', {
      interfaces: {
        get: vi.fn(async () => ({ name: 'wg0', engineType: 'wireguard' })),
      },
      clients: {
        get: vi.fn(async () => ({
          id: 2,
          publicKey: 'pk2',
          enabled: false,
          name: 'client2',
        })),
        toggle: vi.fn(async () => {}),
      },
      auditLogs: {
        create: mockAuditLogsCreate,
      },
    });

    await runQuotaEvaluator();

    expect(mockDisablePeer).not.toHaveBeenCalled();
    expect(mockMarkDisabledByQuota).not.toHaveBeenCalled();
    expect(mockAuditLogsCreate).not.toHaveBeenCalled();
  });

  it('logs error when engine disablePeer fails', async () => {
    mockFindOverLimit.mockResolvedValueOnce([
      {
        clientId: 3,
        limitBytes: 10 * 1024 * 1024,
        usedBytes: 11 * 1024 * 1024,
        period: 'daily',
        periodStart: new Date(Date.now() - 3600_000),
        periodEnd: new Date(Date.now() + 3600_000),
        autoDisable: true,
        disabledByQuotaAt: null,
      },
    ]);

    mockDisablePeer.mockRejectedValueOnce(new Error('wg command failed'));

    await runQuotaEvaluator();

    expect(mockDisablePeer).toHaveBeenCalledTimes(1);
    expect(mockMarkDisabledByQuota).not.toHaveBeenCalled();
    expect(mockAuditLogsCreate).toHaveBeenCalledTimes(1);
    expect(mockAuditLogsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'quota.exceeded',
        target: expect.objectContaining({ clientId: 3, error: 'wg command failed' }),
        result: 'error',
      })
    );
  });
});
