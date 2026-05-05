import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolvePrincipal } from './principal';
import { getHeader } from 'h3';
import { getWGSession, getWGUserSession } from './session';
import { isPasswordValid } from './password';

vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof import('h3')>('h3');
  return {
    ...actual,
    getHeader: vi.fn(),
    createError: actual.createError,
  };
});

vi.mock('./session', () => ({
  getWGSession: vi.fn(),
  getWGUserSession: vi.fn(),
}));

vi.mock('./password', () => ({
  isPasswordValid: vi.fn(),
}));

describe('resolvePrincipal', () => {
  const mockAdminUser = {
    id: 1,
    username: 'admin',
    name: 'Admin',
    password: 'hash',
    email: null,
    role: 1, // ADMIN
    totpKey: null,
    totpVerified: false,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockClientUser = {
    ...mockAdminUser,
    id: 2,
    username: 'alice',
    name: 'Alice',
    role: 2, // CLIENT
  };

  const mockTokenRecord = {
    id: 1,
    userId: 1,
    tokenHash: 'argon2hash',
    label: 'test',
    scopes: JSON.stringify(['client:read']),
    expiresAt: null,
    lastUsedAt: null,
    createdAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    (globalThis as any).Database = {
      users: {
        get: vi.fn(async (id: number) => {
          if (id === mockAdminUser.id) return mockAdminUser;
          if (id === mockClientUser.id) return mockClientUser;
          return undefined;
        }),
        getByUsername: vi.fn(async (username: string) => {
          if (username === mockAdminUser.username) return mockAdminUser;
          if (username === mockClientUser.username) return mockClientUser;
          return undefined;
        }),
      },
      apiTokens: {
        getAll: vi.fn(async () => [mockTokenRecord]),
        updateLastUsed: vi.fn(),
      },
    };
  });

  it('returns null when no auth is provided', async () => {
    vi.mocked(getHeader).mockReturnValue(undefined);
    vi.mocked(getWGSession).mockRejectedValue(new Error('no session'));
    vi.mocked(getWGUserSession).mockRejectedValue(new Error('no session'));

    const event = { headers: {} } as unknown as Parameters<typeof resolvePrincipal>[0];
    const result = await resolvePrincipal(event);
    expect(result).toBeNull();
  });

  it('resolves admin principal from Basic auth', async () => {
    vi.mocked(getHeader).mockReturnValue(
      'Basic ' + Buffer.from('admin:password').toString('base64')
    );
    vi.mocked(getWGSession).mockRejectedValue(new Error('no session'));
    vi.mocked(getWGUserSession).mockRejectedValue(new Error('no session'));
    vi.mocked(isPasswordValid).mockResolvedValue(true);

    const event = { headers: {} } as unknown as Parameters<typeof resolvePrincipal>[0];
    const result = await resolvePrincipal(event);

    expect(result).not.toBeNull();
    expect(result!.kind).toBe('admin');
    expect(result!.user.id).toBe(mockAdminUser.id);
  });

  it('blocks CLIENT-role user from Basic auth', async () => {
    vi.mocked(getHeader).mockReturnValue(
      'Basic ' + Buffer.from('alice:password').toString('base64')
    );
    vi.mocked(getWGSession).mockRejectedValue(new Error('no session'));
    vi.mocked(getWGUserSession).mockRejectedValue(new Error('no session'));
    vi.mocked(isPasswordValid).mockResolvedValue(true);

    const event = { headers: {} } as unknown as Parameters<typeof resolvePrincipal>[0];
    const result = await resolvePrincipal(event);

    expect(result).toBeNull();
  });

  it('resolves token principal from Bearer auth', async () => {
    vi.mocked(getHeader).mockReturnValue('Bearer mytoken');
    vi.mocked(getWGSession).mockRejectedValue(new Error('no session'));
    vi.mocked(getWGUserSession).mockRejectedValue(new Error('no session'));
    vi.mocked(isPasswordValid).mockResolvedValue(true);

    const event = { headers: {} } as unknown as Parameters<typeof resolvePrincipal>[0];
    const result = await resolvePrincipal(event);

    expect(result).not.toBeNull();
    expect(result!.kind).toBe('token');
    expect(result!.user.id).toBe(mockAdminUser.id);
    expect((result as any).scopes).toEqual(['client:read']);
  });

  it('resolves admin principal from wg-session cookie', async () => {
    vi.mocked(getHeader).mockReturnValue(undefined);
    vi.mocked(getWGSession).mockResolvedValue({
      data: { userId: 1 },
      id: 'sess1',
      update: vi.fn(),
      clear: vi.fn(),
    } as any);
    vi.mocked(getWGUserSession).mockRejectedValue(new Error('no session'));

    const event = { headers: {} } as unknown as Parameters<typeof resolvePrincipal>[0];
    const result = await resolvePrincipal(event);

    expect(result).not.toBeNull();
    expect(result!.kind).toBe('admin');
    expect(result!.user.id).toBe(mockAdminUser.id);
  });

  it('resolves user principal from wg-user-session with dashboardUserId', async () => {
    vi.mocked(getHeader).mockReturnValue(undefined);
    vi.mocked(getWGSession).mockRejectedValue(new Error('no session'));
    vi.mocked(getWGUserSession).mockResolvedValue({
      data: { userId: 2, dashboardUserId: 2 },
      id: 'sess2',
      update: vi.fn(),
      clear: vi.fn(),
    } as any);

    const event = { headers: {} } as unknown as Parameters<typeof resolvePrincipal>[0];
    const result = await resolvePrincipal(event);

    expect(result).not.toBeNull();
    expect(result!.kind).toBe('user');
    expect(result!.user.id).toBe(mockClientUser.id);
    expect((result as any).dashboardUserId).toBe(2);
  });

  it('resolves user principal from legacy clientId in session (backward compat)', async () => {
    vi.mocked(getHeader).mockReturnValue(undefined);
    vi.mocked(getWGSession).mockRejectedValue(new Error('no session'));
    vi.mocked(getWGUserSession).mockResolvedValue({
      data: { userId: 2, clientId: 10 }, // old session format
      id: 'sess2',
      update: vi.fn(),
      clear: vi.fn(),
    } as any);

    const event = { headers: {} } as unknown as Parameters<typeof resolvePrincipal>[0];
    const result = await resolvePrincipal(event);

    expect(result).not.toBeNull();
    expect(result!.kind).toBe('user');
    expect((result as any).dashboardUserId).toBe(10); // falls back to clientId
  });

  it('returns null for wg-user-session without dashboardUserId or clientId', async () => {
    vi.mocked(getHeader).mockReturnValue(undefined);
    vi.mocked(getWGSession).mockRejectedValue(new Error('no session'));
    vi.mocked(getWGUserSession).mockResolvedValue({
      data: { userId: 2 },
      id: 'sess2',
      update: vi.fn(),
      clear: vi.fn(),
    } as any);

    const event = { headers: {} } as unknown as Parameters<typeof resolvePrincipal>[0];
    const result = await resolvePrincipal(event);

    expect(result).toBeNull();
  });
});
