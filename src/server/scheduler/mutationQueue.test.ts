import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runMutationQueue } from './mutationQueue';

const mockSyncInterface = vi.fn(async () => {});
const mockGetDue = vi.fn(async () => []);
const mockMarkSuccess = vi.fn(async () => {});
const mockMarkFailure = vi.fn(async () => {});
const mockDelete = vi.fn(async () => {});
const mockAuditLogsCreate = vi.fn(async () => {});

vi.mock('../engines/registry', () => ({
  getEngine: vi.fn(() => ({
    syncInterface: (...args: unknown[]) => mockSyncInterface(...args),
  })),
}));

const mockIface = { id: 'wg0', engineType: 'wireguard' };
const mockClients = [{ id: 1, publicKey: 'pk1', enabled: true }];

describe('runMutationQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('Database', {
      interfaces: { get: vi.fn(async () => mockIface) },
      clients: { getAll: vi.fn(async () => mockClients) },
      auditLogs: { create: mockAuditLogsCreate },
      pendingMutations: {
        getDue: mockGetDue,
        markSuccess: mockMarkSuccess,
        markFailure: mockMarkFailure,
        delete: mockDelete,
        maxAttempts: 10,
      },
    });
  });

  it('does nothing when no mutations are due', async () => {
    mockGetDue.mockResolvedValueOnce([]);
    await runMutationQueue();
    expect(mockSyncInterface).not.toHaveBeenCalled();
  });

  it('processes a mutation successfully and marks it as success', async () => {
    mockGetDue.mockResolvedValueOnce([
      {
        id: 1,
        interfaceId: 'wg0',
        kind: 'syncInterface',
        clientId: 1,
        payload: {},
        attempts: 0,
        nextAttemptAt: new Date(),
        createdAt: new Date(),
      },
    ]);

    await runMutationQueue();

    expect(mockSyncInterface).toHaveBeenCalledOnce();
    expect(mockMarkSuccess).toHaveBeenCalledOnce();
    expect(mockMarkSuccess).toHaveBeenCalledWith(1);
    expect(mockAuditLogsCreate).toHaveBeenCalledOnce();
    expect(mockAuditLogsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'engine.mutation.retry',
        target: expect.objectContaining({ mutationId: 1, attempts: 1 }),
        result: 'ok',
      })
    );
  });

  it('marks failure and retries when syncInterface fails', async () => {
    mockGetDue.mockResolvedValueOnce([
      {
        id: 2,
        interfaceId: 'wg0',
        kind: 'syncInterface',
        clientId: 1,
        payload: {},
        attempts: 2,
        nextAttemptAt: new Date(),
        createdAt: new Date(),
      },
    ]);
    mockSyncInterface.mockRejectedValueOnce(new Error('timeout'));

    await runMutationQueue();

    expect(mockMarkFailure).toHaveBeenCalledOnce();
    expect(mockMarkFailure).toHaveBeenCalledWith(2, 3, 'timeout');
    expect(mockAuditLogsCreate).toHaveBeenCalledOnce();
    expect(mockAuditLogsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'engine.mutation.retry',
        target: expect.objectContaining({ mutationId: 2, attempts: 3, error: 'timeout' }),
        result: 'error',
      })
    );
  });

  it('gives up after maxAttempts and deletes the mutation', async () => {
    mockGetDue.mockResolvedValueOnce([
      {
        id: 3,
        interfaceId: 'wg0',
        kind: 'syncInterface',
        clientId: 1,
        payload: {},
        attempts: 9,
        nextAttemptAt: new Date(),
        createdAt: new Date(),
      },
    ]);
    mockSyncInterface.mockRejectedValueOnce(new Error('permanent failure'));

    await runMutationQueue();

    expect(mockDelete).toHaveBeenCalledOnce();
    expect(mockDelete).toHaveBeenCalledWith(3);
    expect(mockMarkFailure).not.toHaveBeenCalled();
    expect(mockAuditLogsCreate).toHaveBeenCalledOnce();
    expect(mockAuditLogsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'engine.mutation.giveUp',
        target: expect.objectContaining({ mutationId: 3, attempts: 10, error: 'permanent failure' }),
        result: 'error',
      })
    );
  });
});
