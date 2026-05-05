import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runReconciler } from './reconciler';

const mockSyncInterface = vi.fn(async () => {});
const mockAuditLogsCreate = vi.fn(async () => {});
const mockRecordHealth = vi.fn(async () => ({ crossedThreshold: false, recovered: false }));

vi.mock('../engines/registry', () => ({
  getEngine: vi.fn(() => ({
    syncInterface: mockSyncInterface,
  })),
}));

const mockIface = { name: 'wg0', engineType: 'wireguard', routerId: null };
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
      routers: { recordHealth: mockRecordHealth, get: vi.fn(async () => null) },
    });
  });

  it('calls syncInterface with all clients and logs ok', async () => {
    await runReconciler();

    expect(mockSyncInterface).toHaveBeenCalledOnce();
    expect(mockSyncInterface).toHaveBeenCalledWith(mockIface, mockClients);
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

    expect(mockAuditLogsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'engine.reconcile.error',
        target: expect.objectContaining({ interfaceId: 'wg0', error: 'router unreachable' }),
        result: 'error',
      })
    );
  });

  it('emits engine.unreachable audit event on 3rd consecutive failure', async () => {
    mockSyncInterface.mockRejectedValueOnce(new Error('timeout'));
    mockRecordHealth.mockResolvedValueOnce({ crossedThreshold: true, recovered: false });

    const mockIface2 = { ...mockIface, routerId: 42 };
    vi.stubGlobal('Database', {
      interfaces: { get: vi.fn(async () => mockIface2) },
      clients: { getAll: vi.fn(async () => mockClients) },
      auditLogs: { create: mockAuditLogsCreate },
      routers: { recordHealth: mockRecordHealth, get: vi.fn(async () => ({ name: 'tgCHR' })) },
    });

    await expect(runReconciler()).rejects.toThrow('timeout');

    expect(mockAuditLogsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'engine.unreachable', result: 'error' })
    );
  });

  it('emits engine.recovered audit event on recovery', async () => {
    mockRecordHealth.mockResolvedValueOnce({ crossedThreshold: false, recovered: true });

    const mockIface2 = { ...mockIface, routerId: 42 };
    vi.stubGlobal('Database', {
      interfaces: { get: vi.fn(async () => mockIface2) },
      clients: { getAll: vi.fn(async () => mockClients) },
      auditLogs: { create: mockAuditLogsCreate },
      routers: { recordHealth: mockRecordHealth, get: vi.fn(async () => ({ name: 'tgCHR' })) },
    });

    await runReconciler();

    expect(mockAuditLogsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'engine.recovered', result: 'ok' })
    );
  });
});
