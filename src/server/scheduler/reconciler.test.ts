import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runReconciler } from './reconciler';

const mockSyncInterface = vi.fn(async () => {});
const mockAuditLogsCreate = vi.fn(async () => {});

vi.mock('../engines/registry', () => ({
  getEngine: vi.fn(() => ({
    syncInterface: (...args: unknown[]) => mockSyncInterface(...args),
  })),
}));

const mockIface = { id: 'wg0', engineType: 'wireguard' };
const mockClients = [
  { id: 1, publicKey: 'pk1', enabled: true },
  { id: 2, publicKey: 'pk2', enabled: false },
];

describe('runReconciler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('Database', {
      interfaces: { get: vi.fn(async () => mockIface) },
      clients: { getAll: vi.fn(async () => mockClients) },
      auditLogs: { create: mockAuditLogsCreate },
    });
  });

  it('calls syncInterface with all clients and logs ok', async () => {
    await runReconciler();

    expect(mockSyncInterface).toHaveBeenCalledOnce();
    expect(mockSyncInterface).toHaveBeenCalledWith(mockIface, mockClients);
    expect(mockAuditLogsCreate).toHaveBeenCalledOnce();
    expect(mockAuditLogsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'engine.reconcile.ok',
        target: expect.objectContaining({ interfaceId: 'wg0', clientCount: 2 }),
        result: 'ok',
      })
    );
  });

  it('logs error and rethrows when syncInterface fails', async () => {
    mockSyncInterface.mockRejectedValueOnce(new Error('router unreachable'));

    await expect(runReconciler()).rejects.toThrow('router unreachable');

    expect(mockAuditLogsCreate).toHaveBeenCalledOnce();
    expect(mockAuditLogsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'engine.reconcile.error',
        target: expect.objectContaining({ interfaceId: 'wg0', error: 'router unreachable' }),
        result: 'error',
      })
    );
  });
});
