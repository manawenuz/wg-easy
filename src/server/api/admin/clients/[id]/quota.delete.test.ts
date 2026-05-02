import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

describe('admin/clients/[id]/quota.delete', () => {
  const mockUser = (id: number, role: number) => ({
    id,
    username: `user${id}`,
    name: `User ${id}`,
    password: 'hash',
    email: null,
    role,
    totpKey: null,
    totpVerified: false,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  type Handler = (event: {
    context: { principal: { kind: string; user: ReturnType<typeof mockUser> } };
    _params: { id: string };
  }) => Promise<unknown>;

  const makeEvent = (
    principal: { kind: string; user: ReturnType<typeof mockUser> },
    params: { id: string }
  ) =>
    ({ context: { principal }, _params: params }) as Parameters<Handler>[0];

  beforeAll(() => {
    vi.stubGlobal('defineEventHandler', vi.fn((fn: unknown) => fn));
    vi.stubGlobal('requirePermission', vi.fn(async () => {}));
    vi.stubGlobal('createError', vi.fn((opts: { statusCode: number; statusMessage: string }) => {
      const err = new Error(opts.statusMessage);
      (err as Error & { statusCode: number }).statusCode = opts.statusCode;
      throw err;
    }));
    vi.stubGlobal('getRouterParam', vi.fn((event: { _params: Record<string, string> }, name: string) => event._params[name]));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('Database', {
      clients: {
        get: vi.fn(async (id: number) => {
          if (id === 1) return { id: 1, name: 'client1' };
          return undefined;
        }),
      },
      quotas: {
        delete: vi.fn(async () => {}),
      },
      auditLogs: {
        create: vi.fn(async () => {}),
      },
    });
    vi.stubGlobal('logAction', vi.fn(async () => {}));
  });

  it('deletes quota for client', async () => {
    const handler = (await import('./quota.delete')).default as Handler;
    const event = makeEvent(
      { kind: 'user', user: mockUser(1, 3) },
      { id: '1' }
    );

    const result = await handler(event);
    expect(result).toEqual({ ok: true });
    expect(Database.quotas.delete).toHaveBeenCalledWith(1);
  });

  it('returns 404 for nonexistent client', async () => {
    const handler = (await import('./quota.delete')).default as Handler;
    const event = makeEvent(
      { kind: 'user', user: mockUser(1, 3) },
      { id: '99' }
    );

    await expect(handler(event)).rejects.toThrow('Client not found');
  });
});
