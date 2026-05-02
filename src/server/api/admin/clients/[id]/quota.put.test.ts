import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

describe('admin/clients/[id]/quota.put', () => {
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
    _body: object;
  }) => Promise<unknown>;

  const makeEvent = (
    principal: { kind: string; user: ReturnType<typeof mockUser> },
    params: { id: string },
    body: object
  ) =>
    ({ context: { principal }, _params: params, _body: body }) as Parameters<Handler>[0];

  beforeAll(() => {
    vi.stubGlobal('defineEventHandler', vi.fn((fn: unknown) => fn));
    vi.stubGlobal('requirePermission', vi.fn(async () => {}));
    vi.stubGlobal('createError', vi.fn((opts: { statusCode: number; statusMessage: string }) => {
      const err = new Error(opts.statusMessage);
      (err as Error & { statusCode: number }).statusCode = opts.statusCode;
      throw err;
    }));
    vi.stubGlobal('getRouterParam', vi.fn((event: { _params: Record<string, string> }, name: string) => event._params[name]));
    vi.stubGlobal('readValidatedBody', vi.fn(async (event: { _body: object }) => event._body));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('Database', {
      clients: {
        get: vi.fn(async (id: number) => {
          if (id === 1 || id === 2) return { id, name: `client${id}` };
          return undefined;
        }),
      },
      quotas: {
        getByClientId: vi.fn(async (id: number) => {
          if (id === 1) return { clientId: 1, limitBytes: 100, period: 'daily' };
          return undefined;
        }),
        create: vi.fn(async () => {}),
        update: vi.fn(async () => {}),
      },
      auditLogs: {
        create: vi.fn(async () => {}),
      },
    });
    vi.stubGlobal('logAction', vi.fn(async () => {}));
  });

  it('creates quota for new client', async () => {
    const handler = (await import('./quota.put')).default as Handler;
    const event = makeEvent(
      { kind: 'user', user: mockUser(1, 3) },
      { id: '2' },
      { limitBytes: 1073741824, period: 'monthly', autoDisable: true }
    );

    const result = await handler(event);
    expect(result).toEqual({ ok: true });
    expect(Database.quotas.create).toHaveBeenCalled();
  });

  it('updates existing quota', async () => {
    const handler = (await import('./quota.put')).default as Handler;
    const event = makeEvent(
      { kind: 'user', user: mockUser(1, 3) },
      { id: '1' },
      { limitBytes: 2147483648, period: 'weekly' }
    );

    const result = await handler(event);
    expect(result).toEqual({ ok: true });
    expect(Database.quotas.update).toHaveBeenCalled();
  });

  it('returns 404 for nonexistent client', async () => {
    const handler = (await import('./quota.put')).default as Handler;
    const event = makeEvent(
      { kind: 'user', user: mockUser(1, 3) },
      { id: '99' },
      { limitBytes: 1000, period: 'daily' }
    );

    await expect(handler(event)).rejects.toThrow('Client not found');
  });
});
