import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requirePermission, isAdminPrincipal, isSuperAdminPrincipal } from './permissions';
import { roles } from '#shared/utils/permissions';

vi.mock('./principal', () => ({
  resolvePrincipal: vi.fn(),
}));

describe('requirePermission', () => {
  const mockUser = (role: number, id = 1) => ({
    id,
    username: 'test',
    name: 'Test',
    password: 'hash',
    email: null,
    role,
    totpKey: null,
    totpVerified: false,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const makeEvent = (principal: any) =>
    ({ context: { principal } } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).Database = {
      adminRouterAcls: {
        getByUserAndRouter: vi.fn(),
      },
    };
  });

  // --- Superadmin ---
  it('allows superadmin for any permission', async () => {
    const event = makeEvent({ kind: 'admin', user: mockUser(roles.SUPERADMIN) });
    await expect(requirePermission(event, 'router:write')).resolves.toBeUndefined();
    await expect(requirePermission(event, 'admin:settings')).resolves.toBeUndefined();
  });

  // --- Admin with ACL ---
  it('allows admin with write ACL for router:write', async () => {
    const event = makeEvent({ kind: 'admin', user: mockUser(roles.ADMIN) });
    vi.mocked(Database.adminRouterAcls.getByUserAndRouter).mockResolvedValue({ userId: 1, routerId: 1, permission: 'write' } as any);
    await expect(requirePermission(event, 'router:write', { routerId: 1 })).resolves.toBeUndefined();
  });

  it('allows admin with admin ACL for router:admin', async () => {
    const event = makeEvent({ kind: 'admin', user: mockUser(roles.ADMIN) });
    vi.mocked(Database.adminRouterAcls.getByUserAndRouter).mockResolvedValue({ userId: 1, routerId: 1, permission: 'admin' } as any);
    await expect(requirePermission(event, 'router:admin', { routerId: 1 })).resolves.toBeUndefined();
  });

  it('denies admin with read ACL for router:write', async () => {
    const event = makeEvent({ kind: 'admin', user: mockUser(roles.ADMIN) });
    vi.mocked(Database.adminRouterAcls.getByUserAndRouter).mockResolvedValue({ userId: 1, routerId: 1, permission: 'read' } as any);
    await expect(requirePermission(event, 'router:write', { routerId: 1 })).rejects.toThrow();
  });

  it('denies admin without ACL for router:read', async () => {
    const event = makeEvent({ kind: 'admin', user: mockUser(roles.ADMIN) });
    vi.mocked(Database.adminRouterAcls.getByUserAndRouter).mockResolvedValue(undefined);
    await expect(requirePermission(event, 'router:read', { routerId: 1 })).rejects.toThrow();
  });

  // --- Operator ---
  it('allows operator for client:write with write ACL', async () => {
    const event = makeEvent({ kind: 'admin', user: mockUser(roles.OPERATOR) });
    vi.mocked(Database.adminRouterAcls.getByUserAndRouter).mockResolvedValue({ userId: 1, routerId: 1, permission: 'write' } as any);
    await expect(requirePermission(event, 'client:write', { routerId: 1 })).resolves.toBeUndefined();
  });

  it('denies operator for router:write', async () => {
    const event = makeEvent({ kind: 'admin', user: mockUser(roles.OPERATOR) });
    await expect(requirePermission(event, 'router:write')).rejects.toThrow();
  });

  it('denies operator for admin:users', async () => {
    const event = makeEvent({ kind: 'admin', user: mockUser(roles.OPERATOR) });
    await expect(requirePermission(event, 'admin:users')).rejects.toThrow();
  });

  // --- Viewer ---
  it('allows viewer for router:read with read ACL', async () => {
    const event = makeEvent({ kind: 'admin', user: mockUser(roles.VIEWER) });
    vi.mocked(Database.adminRouterAcls.getByUserAndRouter).mockResolvedValue({ userId: 1, routerId: 1, permission: 'read' } as any);
    await expect(requirePermission(event, 'router:read', { routerId: 1 })).resolves.toBeUndefined();
  });

  it('denies viewer for client:write', async () => {
    const event = makeEvent({ kind: 'admin', user: mockUser(roles.VIEWER) });
    await expect(requirePermission(event, 'client:write')).rejects.toThrow();
  });

  // --- Client / dashboard ---
  it('allows user principal for dashboard:self', async () => {
    const event = makeEvent({ kind: 'user', user: mockUser(roles.CLIENT) });
    await expect(requirePermission(event, 'dashboard:self')).resolves.toBeUndefined();
  });

  it('denies client role for router:read', async () => {
    const event = makeEvent({ kind: 'admin', user: mockUser(roles.CLIENT) });
    await expect(requirePermission(event, 'router:read')).rejects.toThrow();
  });

  // --- Token ---
  it('allows token with matching scope', async () => {
    const event = makeEvent({ kind: 'token', user: mockUser(roles.ADMIN), tokenId: 1, scopes: ['client:read'] });
    vi.mocked(Database.adminRouterAcls.getByUserAndRouter).mockResolvedValue({ userId: 1, routerId: 1, permission: 'read' } as any);
    await expect(requirePermission(event, 'client:read', { routerId: 1 })).resolves.toBeUndefined();
  });

  it('denies token without matching scope', async () => {
    const event = makeEvent({ kind: 'token', user: mockUser(roles.ADMIN), tokenId: 1, scopes: ['client:read'] });
    await expect(requirePermission(event, 'admin:users')).rejects.toThrow();
  });

  // --- No principal ---
  it('denies unauthenticated', async () => {
    const event = makeEvent(null);
    await expect(requirePermission(event, 'client:read')).rejects.toThrow();
  });
});

describe('isAdminPrincipal', () => {
  it('returns true for admin', () => {
    expect(isAdminPrincipal({ kind: 'admin', user: { id: 1, role: roles.ADMIN } as any })).toBe(true);
  });

  it('returns true for operator', () => {
    expect(isAdminPrincipal({ kind: 'admin', user: { id: 1, role: roles.OPERATOR } as any })).toBe(true);
  });

  it('returns false for token with client role', () => {
    expect(isAdminPrincipal({ kind: 'token', user: { id: 1, role: roles.CLIENT } as any, tokenId: 1, scopes: [] })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isAdminPrincipal(null)).toBe(false);
  });
});

describe('isSuperAdminPrincipal', () => {
  it('returns true for superadmin', () => {
    expect(isSuperAdminPrincipal({ kind: 'admin', user: { id: 1, role: roles.SUPERADMIN } as any })).toBe(true);
  });

  it('returns false for admin', () => {
    expect(isSuperAdminPrincipal({ kind: 'admin', user: { id: 1, role: roles.ADMIN } as any })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isSuperAdminPrincipal(null)).toBe(false);
  });
});
