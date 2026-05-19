import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

describe('dashboard/me.get', () => {
  const mockUser = (id: number, role: number, name = `User ${id}`) => ({
    id,
    username: `user${id}`,
    name,
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
    context: {
      principal: {
        kind: string;
        user: ReturnType<typeof mockUser>;
        dashboardUserId: number;
      };
    };
  }) => Promise<unknown>;

  const makeEvent = (principal: {
    kind: string;
    user: ReturnType<typeof mockUser>;
    dashboardUserId: number;
  }) => ({ context: { principal } }) as Parameters<Handler>[0];

  beforeAll(() => {
    vi.stubGlobal(
      'defineEventHandler',
      vi.fn((fn: unknown) => fn)
    );
    vi.stubGlobal(
      'requirePermission',
      vi.fn(async () => {})
    );
    vi.stubGlobal(
      'createError',
      vi.fn((opts: { statusCode: number; statusMessage: string }) => {
        const err = new Error(opts.statusMessage);
        (err as Error & { statusCode: number }).statusCode = opts.statusCode;
        throw err;
      })
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('Database', {
      users: {
        get: vi.fn(async (id: number) => {
          if (id === 1) return mockUser(1, 2, 'Alice');
          return undefined;
        }),
      },
      clients: {
        getForUser: vi.fn(async (userId: number) => {
          if (userId === 1) {
            return [
              { id: 1, name: 'alice-phone', userId: 1 },
              { id: 2, name: 'alice-laptop', userId: 1 },
            ];
          }
          return [];
        }),
      },
    });
  });

  it('returns user info and clientsCount for user principal', async () => {
    const handler = (await import('./me.get')).default as unknown as Handler;
    const event = makeEvent({
      kind: 'user',
      user: mockUser(1, 2),
      dashboardUserId: 1,
    });
    const result = (await handler(event)) as {
      user: { id: number; name: string; email: string | null };
      clientsCount: number;
    };

    expect(result.user).toEqual({
      id: 1,
      name: 'Alice',
      email: 'user@example.com',
    });
    expect(result.clientsCount).toBe(2);
  });

  it('returns 404 when user is not found', async () => {
    const handler = (await import('./me.get')).default as unknown as Handler;
    const event = makeEvent({
      kind: 'user',
      user: mockUser(99, 2),
      dashboardUserId: 99,
    });
    await expect(handler(event)).rejects.toThrow('User not found');
  });

  it('rejects admin principal', async () => {
    const handler = (await import('./me.get')).default as unknown as Handler;
    const event = makeEvent({
      kind: 'admin',
      user: mockUser(1, 1),
      dashboardUserId: 1,
    });
    await expect(handler(event)).rejects.toThrow('Forbidden');
  });
});
