import { createError } from 'h3';
import type { H3Event } from 'h3';
import type { Principal } from './principal';
import { roles } from '#shared/utils/permissions';

export type Permission =
  | 'router:read'
  | 'router:write'
  | 'router:admin'
  | 'client:read'
  | 'client:write'
  | 'admin:users'
  | 'admin:settings'
  | 'dashboard:self';

const ROLE_PERMS: Record<number, Permission[]> = {
  [roles.SUPERADMIN]: [
    'router:read',
    'router:write',
    'router:admin',
    'client:read',
    'client:write',
    'admin:users',
    'admin:settings',
    'dashboard:self',
  ],
  [roles.ADMIN]: [
    'router:read',
    'router:write',
    'router:admin',
    'client:read',
    'client:write',
    'admin:users',
    'admin:settings',
    'dashboard:self',
  ],
  [roles.OPERATOR]: [
    'router:read',
    'client:read',
    'client:write',
    'dashboard:self',
  ],
  [roles.VIEWER]: ['router:read', 'client:read', 'dashboard:self'],
  [roles.CLIENT]: ['dashboard:self'],
};

export async function requirePermission(
  event: H3Event,
  perm: Permission,
  resource?: { routerId?: number; userId?: number; clientId?: number }
): Promise<void> {
  const p = event.context.principal ?? (await resolvePrincipal(event));

  if (p) {
    event.context.principal = p;
  }

  if (!p) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    });
  }

  // Token principals: check scopes first
  if (p.kind === 'token') {
    if (!p.scopes.includes(perm)) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
      });
    }
    // Fall through to role + ACL check below
  }

  // User dashboard: only self-access, regardless of underlying user role
  if (p.kind === 'user') {
    if (perm === 'dashboard:self') return;
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
    });
  }

  const u = p.user;

  // Superadmin bypasses ACL
  if (u.role === roles.SUPERADMIN) {
    return;
  }

  // Role-based permission check
  const rolePerms = ROLE_PERMS[u.role];
  if (!rolePerms?.includes(perm)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
    });
  }

  // Router-scoped permissions require an ACL row
  if (
    resource?.routerId !== undefined &&
    (perm.startsWith('router:') || perm.startsWith('client:'))
  ) {
    const acl = await Database.adminRouterAcls.getByUserAndRouter(
      u.id,
      resource.routerId
    );
    if (!acl) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
      });
    }
    if (perm.endsWith(':write') && acl.permission === 'read') {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
      });
    }
    if (perm.endsWith(':admin') && acl.permission !== 'admin') {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
      });
    }
  }
}

function aclAllows(
  aclPermission: 'read' | 'write' | 'admin',
  perm: Permission
): boolean {
  if (perm.endsWith(':admin')) return aclPermission === 'admin';
  if (perm.endsWith(':write')) return aclPermission !== 'read';
  return true;
}

export async function getAllowedRouterIds(
  event: H3Event,
  perm: Extract<Permission, `router:${string}` | `client:${string}`>
): Promise<Set<number> | null> {
  await requirePermission(event, perm);

  const p = event.context.principal;
  if (!p || p.kind === 'user' || p.user.role === roles.SUPERADMIN) {
    return null;
  }

  const acls = await Database.adminRouterAcls.getByUserId(p.user.id);
  return new Set(
    acls
      .filter((acl) => aclAllows(acl.permission, perm))
      .map((acl) => acl.routerId)
  );
}

export async function requireClientPermission(
  event: H3Event,
  perm: Extract<Permission, `client:${string}`>,
  client: { interfaceId: string }
): Promise<void> {
  const iface = await Database.interfaces.get(client.interfaceId);
  await requirePermission(event, perm, { routerId: iface.routerId });
}

export function isAdminPrincipal(p: Principal | null): boolean {
  if (!p) return false;
  if (p.kind === 'admin') return true;
  if (p.kind === 'token') {
    return (
      p.user.role === roles.SUPERADMIN ||
      p.user.role === roles.ADMIN ||
      p.user.role === roles.OPERATOR ||
      p.user.role === roles.VIEWER
    );
  }
  // Dashboard user sessions are NEVER admin, regardless of underlying role
  return false;
}

export function isSuperAdminPrincipal(p: Principal | null): boolean {
  return p?.user.role === roles.SUPERADMIN;
}
