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
    context: { principal: { kind: string; user: ReturnType<typeof mockUser> } };
  }) => Promise<unknown>;

  const makeEvent = (principal: { kind: string; user: ReturnType<typeof mockUser> }) =>
    ({ context: { principal } }) as Parameters<Handler>[0];

  beforeAll(() => {
    vi.stubGlobal('defineEventHandler', vi.fn((fn: unknown) => fn));
    vi.stubGlobal('requirePermission', vi.fn(async () => {}));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('Database', {
      clients: {
        getForUser: vi.fn(async (userId: number) => {
          if (userId === 1) {
            return [
              { id: 1, name: 'client1', enabled: true, ipv4Address: '10.0.0.1', publicKey: 'pk1', userId: 1, expiresAt: null },
              { id: 2, name: 'client2', enabled: true, ipv4Address: '10.0.0.2', publicKey: 'pk2', userId: 1, expiresAt: null },
            ];
          }
          if (userId === 2) {
            return [
              { id: 3, name: 'client3', enabled: true, ipv4Address: '10.0.0.3', publicKey: 'pk3', userId: 2, expiresAt: null },
            ];
          }
          return [];
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

  it('returns only the requester clients', async () => {
    const clientsHandler = (await import('./index.get')).default as Handler;
    const event = makeEvent({ kind: 'user', user: mockUser(1, 2) });
    const result = (await clientsHandler(event)) as Array<{ id: number }>;

    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe(1);
    expect(result[1]!.id).toBe(2);
  });

  it('does not leak other users clients', async () => {
    const clientsHandler = (await import('./index.get')).default as Handler;
    const event = makeEvent({ kind: 'user', user: mockUser(2, 2) });
    const result = (await clientsHandler(event)) as Array<{ id: number }>;

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(3);
  });

  it('includes usage data from engine', async () => {
    const clientsHandler = (await import('./index.get')).default as Handler;
    const event = makeEvent({ kind: 'user', user: mockUser(1, 2) });
    const result = (await clientsHandler(event)) as Array<{
      rxBytes: number | null;
      txBytes: number | null;
      lastHandshakeAt: string | null;
    }>;

    expect(result[0]!.rxBytes).toBe(100);
    expect(result[0]!.txBytes).toBe(200);
    expect(result[0]!.lastHandshakeAt).not.toBeNull();
    expect(result[1]!.rxBytes).toBe(0);
    expect(result[1]!.txBytes).toBe(0);
  });
});
