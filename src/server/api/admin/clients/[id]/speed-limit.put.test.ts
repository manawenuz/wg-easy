import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

describe('admin/clients/[id]/speed-limit.put', () => {
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
    ({
      context: { principal },
      _params: params,
      _body: body,
    }) as Parameters<Handler>[0];

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
      'requireClientPermission',
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
    vi.stubGlobal(
      'getRouterParam',
      vi.fn(
        (event: { _params: Record<string, string> }, name: string) =>
          event._params[name]
      )
    );
    vi.stubGlobal(
      'readValidatedBody',
      vi.fn(async (event: { _body: object }) => event._body)
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('Database', {
      clients: {
        get: vi.fn(async (id: number) => {
          if (id === 1)
            return {
              id: 1,
              name: 'client1',
              publicKey: 'pk1',
              ipv4Address: '10.0.0.1',
            };
          return undefined;
        }),
        getAll: vi.fn(async () => [
          { id: 1, name: 'client1', publicKey: 'pk1', ipv4Address: '10.0.0.1' },
        ]),
      },
      interfaces: {
        get: vi.fn(async () => ({ name: 'wg0', engineType: 'wireguard' })),
      },
      speedLimits: {
        upsert: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        getByClientId: vi.fn(async () => null),
      },
      auditLogs: {
        create: vi.fn(async () => {}),
      },
    });
    vi.stubGlobal(
      'logAction',
      vi.fn(async () => {})
    );

    const mockEngine = {
      capabilities: { speedLimit: 'engine-native' },
      applySpeedLimit: vi.fn(async () => {}),
      clearSpeedLimit: vi.fn(async () => {}),
    };
    vi.stubGlobal(
      'getEngine',
      vi.fn(() => mockEngine)
    );
  });

  it('sets speed limit for client', async () => {
    const handler = (await import('./speed-limit.put'))
      .default as unknown as Handler;
    const event = makeEvent(
      { kind: 'user', user: mockUser(1, 3) },
      { id: '1' },
      { upKbps: 512, downKbps: 1024 }
    );

    const result = await handler(event);
    expect(result).toEqual({ ok: true });
  });

  it('clears speed limit when both values are zero', async () => {
    const handler = (await import('./speed-limit.put'))
      .default as unknown as Handler;
    const event = makeEvent(
      { kind: 'user', user: mockUser(1, 3) },
      { id: '1' },
      { upKbps: 0, downKbps: 0 }
    );

    const result = await handler(event);
    expect(result).toEqual({ ok: true });
  });

  it('returns 404 for nonexistent client', async () => {
    const handler = (await import('./speed-limit.put'))
      .default as unknown as Handler;
    const event = makeEvent(
      { kind: 'user', user: mockUser(1, 3) },
      { id: '99' },
      { upKbps: 512, downKbps: 1024 }
    );

    await expect(handler(event)).rejects.toThrow('Client not found');
  });
});
