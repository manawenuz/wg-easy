import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('#shared/utils/permissions', () => ({
  roles: { CLIENT: 2 },
}));

describe('SSR auth middleware', () => {
  const mockPrincipal = {
    kind: 'admin',
    user: {
      id: 1,
      role: 1,
      username: 'admin',
      name: 'Admin',
      email: 'admin@example.com',
      totpVerified: false,
    },
  };

  beforeAll(() => {
    vi.stubGlobal('defineNuxtRouteMiddleware', vi.fn((fn: unknown) => fn));
    vi.stubGlobal('useRequestEvent', vi.fn());
    vi.stubGlobal('useAuthStore', vi.fn(() => ({
      principal: null,
      userData: null,
      getSession: vi.fn(),
    })));
    vi.stubGlobal('navigateTo', vi.fn((path: string, opts?: unknown) => ({ path, opts })));
    vi.stubGlobal('abortNavigation', vi.fn(() => ({ type: 'abort' })));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads principal from event.context.principal on SSR (no direct resolvePrincipal call)', async () => {
    const authStore = {
      principal: null,
      userData: null,
      getSession: vi.fn(),
    };

    vi.mocked(useAuthStore).mockReturnValue(authStore as any);
    vi.mocked(useRequestEvent).mockReturnValue({
      context: { principal: mockPrincipal },
    });

    const { default: authMiddleware } = await import('../app/middleware/auth.global');
    const to = { path: '/' };
    await (authMiddleware as any)(to);

    // Should populate authStore from event.context.principal
    expect(authStore.principal).toBe(mockPrincipal);
    expect(authStore.userData).toEqual({
      id: mockPrincipal.user.id,
      role: mockPrincipal.user.role,
      username: mockPrincipal.user.username,
      name: mockPrincipal.user.name,
      email: mockPrincipal.user.email,
      totpVerified: mockPrincipal.user.totpVerified,
    });
  });

  it('redirects unauthenticated SSR requests to /login', async () => {
    const authStore = {
      principal: null,
      userData: null,
      getSession: vi.fn(),
    };

    vi.mocked(useAuthStore).mockReturnValue(authStore as any);
    vi.mocked(useRequestEvent).mockReturnValue({
      context: {},
    });

    const { default: authMiddleware } = await import('../app/middleware/auth.global');
    const to = { path: '/' };
    await (authMiddleware as any)(to);

    expect(navigateTo).toHaveBeenCalledWith('/login', { redirectCode: 302 });
  });

  it('allows access to /login when unauthenticated', async () => {
    const authStore = {
      principal: null,
      userData: null,
      getSession: vi.fn(),
    };

    vi.mocked(useAuthStore).mockReturnValue(authStore as any);
    vi.mocked(useRequestEvent).mockReturnValue({
      context: {},
    });

    const { default: authMiddleware } = await import('../app/middleware/auth.global');
    const to = { path: '/login' };
    await (authMiddleware as any)(to);

    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('redirects authenticated users away from /login', async () => {
    const authStore = {
      principal: mockPrincipal,
      userData: {
        id: 1,
        role: 1,
        username: 'admin',
        name: 'Admin',
        email: 'admin@example.com',
        totpVerified: false,
      },
      getSession: vi.fn(),
    };

    vi.mocked(useAuthStore).mockReturnValue(authStore as any);
    vi.mocked(useRequestEvent).mockReturnValue({
      context: { principal: mockPrincipal },
    });

    const { default: authMiddleware } = await import('../app/middleware/auth.global');
    const to = { path: '/login' };
    await (authMiddleware as any)(to);

    expect(navigateTo).toHaveBeenCalledWith('/', { redirectCode: 302 });
  });

  it('falls back to client-side session fetch when event is absent', async () => {
    const sessionData = { username: 'admin', role: 1 };
    const authStore = {
      principal: null,
      userData: null,
      getSession: vi.fn().mockResolvedValue(sessionData),
    };

    vi.mocked(useAuthStore).mockReturnValue(authStore as any);
    vi.mocked(useRequestEvent).mockReturnValue(undefined);

    const { default: authMiddleware } = await import('../app/middleware/auth.global');
    const to = { path: '/' };
    await (authMiddleware as any)(to);

    expect(authStore.getSession).toHaveBeenCalled();
    expect(authStore.userData).toBe(sessionData);
  });
});
