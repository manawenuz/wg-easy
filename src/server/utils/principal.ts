import { getHeader, createError } from 'h3';
import type { H3Event } from 'h3';
import type { UserType } from '#db/repositories/user/types';
import { isPasswordValid } from './password';
import { getWGSession, getWGUserSession } from './session';

export type Principal =
  | { kind: 'admin'; user: UserType }
  | { kind: 'user'; user: UserType }
  | { kind: 'token'; user: UserType; tokenId: number; scopes: string[] };

export async function resolvePrincipal(
  event: H3Event
): Promise<Principal | null> {
  const authorization = getHeader(event, 'Authorization');

  // 1. Bearer token
  if (authorization) {
    const [method, value] = authorization.split(' ');

    if (method === 'Bearer' && value) {
      const tokenPrincipal = await resolveBearerToken(value);
      if (tokenPrincipal) return tokenPrincipal;
    }

    // 2. Basic auth → admin
    if (method === 'Basic' && value) {
      const adminPrincipal = await resolveBasicAuth(value);
      if (adminPrincipal) return adminPrincipal;
    }
  }

  // 3. Admin session cookie
  try {
    const session = await getWGSession(event);
    if (session.data.userId) {
      const user = await Database.users.get(session.data.userId);
      if (user && user.enabled) {
        return { kind: 'admin', user };
      }
    }
  } catch {
    // ignore session errors
  }

  // 4. User session cookie
  try {
    const userSession = await getWGUserSession(event);
    if (userSession.data.userId) {
      const user = await Database.users.get(userSession.data.userId);
      if (user && user.enabled) {
        return { kind: 'user', user };
      }
    }
  } catch {
    // ignore session errors
  }

  return null;
}

async function resolveBearerToken(tokenValue: string): Promise<Principal | null> {
  const tokens = await Database.apiTokens.getAll();
  const now = Date.now();

  for (const tokenRecord of tokens) {
    if (tokenRecord.expiresAt && tokenRecord.expiresAt.getTime() < now) {
      continue;
    }

    const valid = await isPasswordValid(tokenValue, tokenRecord.tokenHash);
    if (valid) {
      const user = await Database.users.get(tokenRecord.userId);
      if (!user || !user.enabled) {
        return null;
      }

      await Database.apiTokens.updateLastUsed(tokenRecord.id);

      const scopes = tokenRecord.scopes
        ? (JSON.parse(tokenRecord.scopes) as string[])
        : [];

      return {
        kind: 'token',
        user,
        tokenId: tokenRecord.id,
        scopes,
      };
    }
  }

  return null;
}

async function resolveBasicAuth(value: string): Promise<Principal | null> {
  const basicValue = Buffer.from(value, 'base64').toString('utf-8');
  const index = basicValue.indexOf(':');
  const username = basicValue.substring(0, index);
  const password = basicValue.substring(index + 1);

  if (!username || !password) return null;

  const foundUser = await Database.users.getByUsername(username);
  if (!foundUser) return null;

  const passwordValid = await isPasswordValid(password, foundUser.password);
  if (!passwordValid) return null;

  if (!foundUser.enabled) return null;

  return { kind: 'admin', user: foundUser };
}

declare module 'h3' {
  interface H3EventContext {
    principal?: Principal;
  }
}
