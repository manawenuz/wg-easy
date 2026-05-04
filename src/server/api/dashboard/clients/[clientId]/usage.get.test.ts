import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

describe('dashboard/usage.get', () => {
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
    context: { principal: { kind: string; user: ReturnType<typeof mockUser>; clientId: number } };
    _query: Record<string, string>;
    _params: { clientId: string };
  }) => Promise<unknown>;

  const makeEvent = (
    principal: { kind: string; user: ReturnType<typeof mockUser>; clientId: number },
    query: Record<string, string>,
    params: { clientId: string }
  ) =>
    ({ context: { principal }, _query: query, _params: params }) as Parameters<Handler>[0];

  beforeAll(() => {
    vi.stubGlobal('defineEventHandler', vi.fn((fn: unknown) => fn));
    vi.stubGlobal('requirePermission', vi.fn(async () => {}));
    vi.stubGlobal('createError', vi.fn((opts: { statusCode: number; statusMessage: string }) => {
      const err = new Error(opts.statusMessage);
      (err as Error & { statusCode: number }).statusCode = opts.statusCode;
      throw err;
    }));
    vi.stubGlobal('getRouterParam', vi.fn((event: { _params: Record<string, string> }, name: string) => event._params[name]));
    vi.stubGlobal('getValidatedQuery', vi.fn(async (event: { _query: Record<string, string> }) => event._query));
    vi.stubGlobal('validateZod', vi.fn(() => vi.fn(async (data: unknown) => data)));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('Database', {
      clients: {
        get: vi.fn(async (id: number) => {
          if (id === 1) {
            return { id: 1, userId: 1, name: 'client1' };
          }
          return undefined;
        }),
      },
      usageSamples: {
        getByClientId: vi.fn(async (clientId: number) => {
          if (clientId !== 1) return [];
          // Use a fixed base aligned to a 5-minute bucket boundary so the
          // two inner samples always land in the same bucket.
          const bucketMs = 5 * 60 * 1000;
          const base = Math.floor(Date.now() / bucketMs) * bucketMs;
          return [
            { clientId: 1, rxBytes: 100, txBytes: 200, ts: new Date(base - 4 * 60 * 1000) },
            { clientId: 1, rxBytes: 150, txBytes: 250, ts: new Date(base - 3 * 60 * 1000) },
            { clientId: 1, rxBytes: 200, txBytes: 300, ts: new Date(base - bucketMs - 4 * 60 * 1000) },
          ];
        }),
      },
    });
  });

  it('returns correctly bucketed data for 24h range', async () => {
    const usageHandler = (await import('./usage.get')).default as Handler;
    const event = makeEvent(
      { kind: 'user', user: mockUser(1, 2), clientId: 1 },
      { range: '24h' },
      { clientId: '1' }
    );

    const result = (await usageHandler(event)) as {
      buckets: Array<{ ts: number; rxBytes: number; txBytes: number }>;
    };

    expect(result.buckets).toBeInstanceOf(Array);
    expect(result.buckets.length).toBeGreaterThan(0);

    // Two samples within the same 5-min bucket should be aggregated as deltas
    const latestBucket = result.buckets[result.buckets.length - 1];
    expect(latestBucket!.rxBytes).toBe(50); // 150 - 100
    expect(latestBucket!.txBytes).toBe(50); // 250 - 200
  });

  it('returns 403 for client not bound to session', async () => {
    const usageHandler = (await import('./usage.get')).default as Handler;
    const event = makeEvent(
      { kind: 'user', user: mockUser(2, 2), clientId: 2 },
      { range: '24h' },
      { clientId: '1' }
    );

    await expect(usageHandler(event)).rejects.toThrow('Forbidden');
  });
});
