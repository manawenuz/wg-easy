import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

describe('admin/users/[id]/quota.get', () => {
  const mockUser = (id: number, role: number, parentUserId: number | null = null) => ({
    id,
    username: `user${id}`,
    name: `User ${id}`,
    password: 'hash',
    email: null,
    role,
    totpKey: null,
    totpVerified: false,
    enabled: true,
    parentUserId,
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
      users: {
        getRootUserId: vi.fn(async (id: number) => {
          if (id === 2) return 1; // sub-account 2 → root 1
          return id;
        }),
      },
      quotas: {
        getByUserId: vi.fn(async (id: number) => {
          if (id === 1) {
            return {
              userId: 1,
              limitBytes: 1073741824,
              usedBytes: 536870912,
              period: 'daily',
              periodStart: new Date(),
              periodEnd: new Date(Date.now() + 86400000),
              autoDisable: true,
              disabledByQuotaAt: null,
            };
          }
          return undefined;
        }),
      },
    });
  });

  it('returns quota for root user', async () => {
    const handler = (await import('./quota.get')).default as Handler;
    const event = makeEvent(
      { kind: 'user', user: mockUser(1, 3) },
      { id: '1' }
    );

    const result = await handler(event);
    expect(result).toMatchObject({
      userId: 1,
      limitBytes: 1073741824,
      usedBytes: 536870912,
      period: 'daily',
      inheritedFromUserId: undefined,
    });
  });

  it('returns inherited quota for sub-account with inheritedFromUserId', async () => {
    const handler = (await import('./quota.get')).default as Handler;
    const event = makeEvent(
      { kind: 'user', user: mockUser(2, 2, 1) },
      { id: '2' }
    );

    const result = await handler(event);
    expect(result).toMatchObject({
      userId: 1,
      limitBytes: 1073741824,
      inheritedFromUserId: 1,
    });
  });

  it('returns null when no quota exists', async () => {
    const handler = (await import('./quota.get')).default as Handler;
    const event = makeEvent(
      { kind: 'user', user: mockUser(1, 3) },
      { id: '99' }
    );

    const result = await handler(event);
    expect(result).toBeNull();
  });

  it('rejects invalid user id', async () => {
    const handler = (await import('./quota.get')).default as Handler;
    const event = makeEvent(
      { kind: 'user', user: mockUser(1, 3) },
      { id: 'invalid' }
    );

    await expect(handler(event)).rejects.toThrow('Invalid user ID');
  });
});
