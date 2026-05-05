import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../../engines/registry', () => ({
  getEngine: vi.fn(() => ({
    sampleUsage: vi.fn(async () => [
      { publicKey: 'pk1', lastHandshakeAt: new Date().toISOString(), rxBytes: 100n, txBytes: 200n },
      { publicKey: 'pk2', lastHandshakeAt: null, rxBytes: 0n, txBytes: 0n },
    ]),
  })),
}));

describe('dashboard/clients.get', () => {
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
    context: { principal: { kind: string; user: ReturnType<typeof mockUser>; dashboardUserId: number } };
  }) => Promise<unknown>;

  const makeEvent = (principal: { kind: string; user: ReturnType<typeof mockUser>; dashboardUserId: number }) =>
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
        getForUser: vi.fn(async (userId: number) => {
          const all = [
            { id: 1, name: 'client1', enabled: true, ipv4Address: '10.0.0.1', publicKey: 'pk1', userId: 1, expiresAt: null },
            { id: 2, name: 'client2', enabled: true, ipv4Address: '10.0.0.2', publicKey: 'pk2', userId: 1, expiresAt: null },
            { id: 3, name: 'client3', enabled: true, ipv4Address: '10.0.0.3', publicKey: 'pk3', userId: 2, expiresAt: null },
          ];
          return all.filter((c) => c.userId === userId);
        }),
      },
      interfaces: {
        get: vi.fn(async () => ({ name: 'wg0' })),
      },
      quotas: {
        getAll: vi.fn(async () => []),
      },
      speedLimits: {
        getAll: vi.fn(async () => []),
      },
    });
  });

  it('returns all clients owned by dashboardUserId', async () => {
    const handler = (await import('./index.get')).default as Handler;
    const event = makeEvent({ kind: 'user', user: mockUser(1, 2), dashboardUserId: 1 });
    const result = (await handler(event)) as Array<{ id: number }>;

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual([1, 2]);
  });

  it('returns empty array when user has no clients', async () => {
    const handler = (await import('./index.get')).default as Handler;
    const event = makeEvent({ kind: 'user', user: mockUser(99, 2), dashboardUserId: 99 });
    const result = (await handler(event)) as Array<{ id: number }>;

    expect(result).toHaveLength(0);
  });

  it('does not leak clients of other users', async () => {
    const handler = (await import('./index.get')).default as Handler;
    const event = makeEvent({ kind: 'user', user: mockUser(2, 2), dashboardUserId: 2 });
    const result = (await handler(event)) as Array<{ id: number }>;

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(3);
  });

  it('includes usage data from engine', async () => {
    const handler = (await import('./index.get')).default as Handler;
    const event = makeEvent({ kind: 'user', user: mockUser(1, 2), dashboardUserId: 1 });
    const result = (await handler(event)) as Array<{
      id: number;
      rxBytes: number | null;
      txBytes: number | null;
      lastHandshakeAt: string | null;
    }>;

    const c1 = result.find((r) => r.id === 1)!;
    expect(c1.rxBytes).toBe(100);
    expect(c1.txBytes).toBe(200);
    expect(c1.lastHandshakeAt).not.toBeNull();
  });

  it('rejects non-user principal', async () => {
    const handler = (await import('./index.get')).default as Handler;
    const event = makeEvent({ kind: 'admin', user: mockUser(1, 1), dashboardUserId: 1 });
    await expect(handler(event)).rejects.toThrow('Forbidden');
  });
});
