import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { roles } from '#shared/utils/permissions';

describe('session.get', () => {
  const mockUser = (id: number, role: number, name = 'Test') => ({
    id,
    username: `user${id}`,
    name,
    password: 'hash',
    email: 'test@example.com',
    role,
    totpKey: null,
    totpVerified: false,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  type Handler = (event: {
    context: Record<string, unknown>;
  }) => Promise<unknown>;

  beforeAll(() => {
    vi.stubGlobal('defineEventHandler', vi.fn((fn: unknown) => fn));
    vi.stubGlobal('createError', vi.fn((opts: { statusCode: number; statusMessage: string }) => {
      const err = new Error(opts.statusMessage);
      (err as Error & { statusCode: number }).statusCode = opts.statusCode;
      throw err;
    }));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns CLIENT role for user principal even if underlying role is ADMIN', async () => {
    const { resolvePrincipal } = await import('../utils/principal');
    vi.stubGlobal('resolvePrincipal', vi.fn(async () => ({
      kind: 'user',
      user: mockUser(1, roles.ADMIN),
      dashboardUserId: 1,
    })));

    const sessionHandler = (await import('./session.get')).default as Handler;
    const result = await sessionHandler({ context: {} });

    expect(result).toMatchObject({
      id: 1,
      role: roles.CLIENT,
      name: 'Test',
    });
  });

  it('returns original role for admin principal', async () => {
    const { resolvePrincipal } = await import('../utils/principal');
    vi.stubGlobal('resolvePrincipal', vi.fn(async () => ({
      kind: 'admin',
      user: mockUser(1, roles.ADMIN),
    })));

    const sessionHandler = (await import('./session.get')).default as Handler;
    const result = await sessionHandler({ context: {} });

    expect(result).toMatchObject({
      id: 1,
      role: roles.ADMIN,
      name: 'Test',
    });
  });

  it('returns 401 when not authenticated', async () => {
    const { resolvePrincipal } = await import('../utils/principal');
    vi.stubGlobal('resolvePrincipal', vi.fn(async () => null));

    const sessionHandler = (await import('./session.get')).default as Handler;
    await expect(sessionHandler({ context: {} })).rejects.toThrow('Not authenticated');
  });
});
