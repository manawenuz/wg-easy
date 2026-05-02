import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logAction } from './audit';

describe('logAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).Database = {
      auditLogs: {
        create: vi.fn(),
      },
    };
  });

  it('writes an audit row with principal', async () => {
    const event = {
      context: {
        principal: { user: { id: 42 } },
      },
    } as any;

    await logAction(event, 'user.create', { userId: 1 }, 'ok');

    expect(Database.auditLogs.create).toHaveBeenCalledWith({
      actorUserId: 42,
      action: 'user.create',
      target: { userId: 1 },
      result: 'ok',
    });
  });

  it('writes an audit row without principal (system)', async () => {
    const event = { context: {} } as any;

    await logAction(event, 'quota.auto_disable', { clientId: 5 });

    expect(Database.auditLogs.create).toHaveBeenCalledWith({
      actorUserId: null,
      action: 'quota.auto_disable',
      target: { clientId: 5 },
      result: 'ok',
    });
  });
});
