import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

describe('admin/clients/[id]/speed-limit.get', () => {
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
          if (id === 1) return { id: 1, name: 'client1', publicKey: 'pk1' };
          if (id === 2) return { id: 2, name: 'client2', publicKey: 'pk2' };
          return undefined;
        }),
      },
      speedLimits: {
        getByClientId: vi.fn(async (id: number) => {
          if (id === 1) return { clientId: 1, upKbps: 512, downKbps: 1024 };
          return null;
        }),
      },
    });
  });

  it('returns existing speed limit for client', async () => {
    const handler = (await import('./speed-limit.get')).default as Handler;
    const event = makeEvent(
      { kind: 'user', user: mockUser(1, 3) },
      { id: '1' }
    );

    const result = await handler(event);
    expect(result).toEqual({ upKbps: 512, downKbps: 1024 });
  });

  it('returns zeros when no speed limit exists', async () => {
    const handler = (await import('./speed-limit.get')).default as Handler;
    const event = makeEvent(
      { kind: 'user', user: mockUser(1, 3) },
      { id: '2' }
    );

    const result = await handler(event);
    expect(result).toEqual({ upKbps: 0, downKbps: 0 });
  });

  it('returns 404 for nonexistent client', async () => {
    const handler = (await import('./speed-limit.get')).default as Handler;
    const event = makeEvent(
      { kind: 'user', user: mockUser(1, 3) },
      { id: '99' }
    );

    await expect(handler(event)).rejects.toThrow('Client not found');
  });
});
