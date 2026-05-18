import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runQuotaEvaluator } from './quotaEvaluator';

const mockDisablePeer = vi.fn(async () => {});
const mockMarkDisabledByQuota = vi.fn(async () => {});
const mockAuditLogsCreate = vi.fn(async () => {});
const mockEvaluateAll = vi.fn(async () => []);

vi.mock('../engines/registry', () => ({
  getEngine: vi.fn(() => ({
    disablePeer: (...args: unknown[]) => mockDisablePeer(...args),
  })),
}));

vi.mock('../services/quotaService', () => ({
  quotaService: {
    evaluateAll: (...args: unknown[]) => mockEvaluateAll(...args),
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
        getForUsers: vi.fn(async (userIds: number[]) => {
          const all = [
            { id: 10, publicKey: 'pk10', enabled: true, name: 'peer1', userId: 1 },
            { id: 11, publicKey: 'pk11', enabled: true, name: 'peer2', userId: 1 },
            { id: 12, publicKey: 'pk12', enabled: true, name: 'peer3', userId: 2 },
            { id: 13, publicKey: 'pk13', enabled: true, name: 'peer4', userId: 3 },
          ];
          return all.filter((c) => userIds.includes(c.userId));
        }),
        toggle: vi.fn(async () => {}),
      },
      users: {
        getFamilyMemberIds: vi.fn(async (rootId: number) => {
          if (rootId === 1) return [1, 2, 3];
          return [rootId];
        }),
      },
      auditLogs: {
        create: mockAuditLogsCreate,
      },
    });
  });

  it('disables all family peers belonging to an over-limit root and creates family audit log', async () => {
    mockEvaluateAll.mockResolvedValueOnce([
      {
        userId: 1,
        overLimit: true,
        autoDisable: true,
        usedBytes: 11 * 1024 * 1024,
        limitBytes: 10 * 1024 * 1024,
      },
    ]);

    await runQuotaEvaluator();

    expect(Database.clients.toggle).toHaveBeenCalledTimes(4);
    expect(Database.clients.toggle).toHaveBeenCalledWith(10, false);
    expect(Database.clients.toggle).toHaveBeenCalledWith(11, false);
    expect(Database.clients.toggle).toHaveBeenCalledWith(12, false);
    expect(Database.clients.toggle).toHaveBeenCalledWith(13, false);

    expect(mockDisablePeer).toHaveBeenCalledTimes(4);

    expect(mockMarkDisabledByQuota).toHaveBeenCalledTimes(1);
    expect(mockMarkDisabledByQuota).toHaveBeenCalledWith(1);

    expect(mockAuditLogsCreate).toHaveBeenCalledTimes(1);
    expect(mockAuditLogsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'family.quota.exceeded',
        target: expect.objectContaining({
          rootUserId: 1,
          usedBytes: 11 * 1024 * 1024,
          limitBytes: 10 * 1024 * 1024,
          disabledClientIds: [10, 11, 12, 13],
        }),
        result: 'ok',
      })
    );
  });

  it('skips users with no enabled peers', async () => {
    mockEvaluateAll.mockResolvedValueOnce([
      {
        userId: 1,
        overLimit: true,
        autoDisable: true,
        usedBytes: 11 * 1024 * 1024,
        limitBytes: 10 * 1024 * 1024,
      },
    ]);

    vi.stubGlobal('Database', {
      interfaces: {
        get: vi.fn(async () => ({ name: 'wg0', engineType: 'wireguard' })),
      },
      clients: {
        getForUsers: vi.fn(async () => [
          { id: 10, publicKey: 'pk10', enabled: false, name: 'peer1', userId: 1 },
        ]),
        toggle: vi.fn(async () => {}),
      },
      users: {
        getFamilyMemberIds: vi.fn(async () => [1]),
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

  it('logs per-peer error but still marks disabled when at least one succeeds', async () => {
    mockEvaluateAll.mockResolvedValueOnce([
      {
        userId: 1,
        overLimit: true,
        autoDisable: true,
        usedBytes: 11 * 1024 * 1024,
        limitBytes: 10 * 1024 * 1024,
      },
    ]);

    mockDisablePeer.mockRejectedValueOnce(new Error('wg command failed'));

    await runQuotaEvaluator();

    expect(mockDisablePeer).toHaveBeenCalledTimes(4);
    expect(mockMarkDisabledByQuota).toHaveBeenCalledTimes(1);
    expect(mockAuditLogsCreate).toHaveBeenCalledTimes(2);
    // One error log for the failed peer, one success log for the family
    expect(mockAuditLogsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'quota.exceeded',
        target: expect.objectContaining({ userId: 1, error: 'wg command failed' }),
        result: 'error',
      })
    );
    expect(mockAuditLogsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'family.quota.exceeded',
        target: expect.objectContaining({ rootUserId: 1 }),
        result: 'ok',
      })
    );
  });
});
