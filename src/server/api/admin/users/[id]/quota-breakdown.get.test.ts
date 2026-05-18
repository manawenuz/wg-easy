import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

describe('admin/users/[id]/quota-breakdown.get', () => {
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
          if (id === 2 || id === 3) return 1;
          return id;
        }),
        getFamilyMemberIds: vi.fn(async () => [1, 2, 3]),
        get: vi.fn(async (id: number) => {
          if (id === 1) return mockUser(1, 3, null);
          if (id === 2) return mockUser(2, 2, 1);
          if (id === 3) return mockUser(3, 2, 1);
          return undefined;
        }),
      },
      clients: {
        getForUsers: vi.fn(async () => [
          { id: 10, userId: 1, publicKey: 'pk10', enabled: true, name: 'peer1' },
          { id: 11, userId: 2, publicKey: 'pk11', enabled: true, name: 'peer2' },
          { id: 12, userId: 3, publicKey: 'pk12', enabled: true, name: 'peer3' },
        ]),
      },
      quotas: {
        getByUserId: vi.fn(async (id: number) => {
          if (id === 1) {
            return {
              userId: 1,
              limitBytes: 1073741824,
              usedBytes: 600000000,
              period: 'daily',
              periodStart: new Date('2026-01-01'),
              periodEnd: new Date('2026-01-02'),
              autoDisable: true,
              disabledByQuotaAt: null,
            };
          }
          return undefined;
        }),
      },
      usageSamples: {
        getForClients: vi.fn(async () => [
          { clientId: 10, rxBytes: 100_000_000, txBytes: 100_000_000, ts: new Date() },
          { clientId: 11, rxBytes: 150_000_000, txBytes: 150_000_000, ts: new Date() },
          { clientId: 12, rxBytes: 50_000_000, txBytes: 50_000_000, ts: new Date() },
        ]),
      },
    });
  });

  it('returns family breakdown with per-member usage', async () => {
    const handler = (await import('./quota-breakdown.get')).default as Handler;
    const event = makeEvent(
      { kind: 'user', user: mockUser(1, 3) },
      { id: '1' }
    );

    const result = await handler(event);
    expect(result).toMatchObject({
      rootUserId: 1,
      limitBytes: 1073741824,
      members: expect.arrayContaining([
        expect.objectContaining({ userId: 1, usedBytes: 200_000_000, clientIds: [10] }),
        expect.objectContaining({ userId: 2, usedBytes: 300_000_000, clientIds: [11] }),
        expect.objectContaining({ userId: 3, usedBytes: 100_000_000, clientIds: [12] }),
      ]),
    });
  });

  it('returns null when no quota exists', async () => {
    vi.stubGlobal('Database', {
      ...Database,
      quotas: {
        getByUserId: vi.fn(async () => undefined),
      },
    });

    const handler = (await import('./quota-breakdown.get')).default as Handler;
    const event = makeEvent(
      { kind: 'user', user: mockUser(1, 3) },
      { id: '99' }
    );

    const result = await handler(event);
    expect(result).toBeNull();
  });

  it('rejects invalid user id', async () => {
    const handler = (await import('./quota-breakdown.get')).default as Handler;
    const event = makeEvent(
      { kind: 'user', user: mockUser(1, 3) },
      { id: 'invalid' }
    );

    await expect(handler(event)).rejects.toThrow('Invalid user ID');
  });
});
