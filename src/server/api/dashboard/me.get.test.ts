import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

describe('dashboard/me.get', () => {
  const mockUser = (id: number, role: number) => ({
    id,
    username: `user${id}`,
    name: `User ${id}`,
    password: 'hash',
    email: 'user@example.com',
    role,
    totpKey: null,
    totpVerified: false,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  type Handler = (event: {
    context: { principal: { kind: string; user: ReturnType<typeof mockUser> } };
  }) => Promise<unknown>;

  const makeEvent = (principal: { kind: string; user: ReturnType<typeof mockUser> }) =>
    ({ context: { principal } }) as Parameters<Handler>[0];

  beforeAll(() => {
    vi.stubGlobal('defineEventHandler', vi.fn((fn: unknown) => fn));
    vi.stubGlobal('requirePermission', vi.fn(async () => {}));
    vi.stubGlobal('createError', vi.fn((opts: { statusCode: number; statusMessage: string }) => {
      const err = new Error(opts.statusMessage);
      (err as Error & { statusCode: number }).statusCode = opts.statusCode;
      throw err;
    }));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('Database', {
      clients: {
        getForUser: vi.fn(async (userId: number) =>
          userId === 1
            ? [{ id: 1, name: 'client1' }, { id: 2, name: 'client2' }]
            : []
        ),
      },
    });
  });

  it('returns user info and clients count for user principal', async () => {
    const meHandler = (await import('./me.get')).default as Handler;
    const event = makeEvent({ kind: 'user', user: mockUser(1, 2) });
    const result = (await meHandler(event)) as {
      user: { id: number; name: string; email: string | null };
      clientsCount: number;
    };

    expect(result.user).toEqual({
      id: 1,
      name: 'User 1',
      email: 'user@example.com',
    });
    expect(result.clientsCount).toBe(2);
  });

  it('returns clients count 0 when user has no clients', async () => {
    const meHandler = (await import('./me.get')).default as Handler;
    const event = makeEvent({ kind: 'user', user: mockUser(99, 2) });
    const result = (await meHandler(event)) as {
      user: { id: number; name: string; email: string | null };
      clientsCount: number;
    };

    expect(result.clientsCount).toBe(0);
  });

  it('rejects admin principal', async () => {
    const meHandler = (await import('./me.get')).default as Handler;
    const event = makeEvent({ kind: 'admin', user: mockUser(1, 1) });

    await expect(meHandler(event)).rejects.toThrow('Forbidden');
  });
});
