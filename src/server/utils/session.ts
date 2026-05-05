import type { H3Event } from 'h3';
import type { UserType } from '#db/repositories/user/types';

export type WGSession = Partial<{
  userId: ID;
  /** @deprecated use dashboardUserId */
  clientId: ID;
  dashboardUserId: ID;
}>;

const name = 'wg-easy';
const userSessionName = 'wg-user-session';

export async function useWGSession(event: H3Event, rememberMe = false) {
  const sessionConfig = await Database.general.getSessionConfig();
  return useSession<WGSession>(event, {
    password: sessionConfig.sessionPassword,
    name,
    // TODO: add session expiration
    // maxAge: undefined
    cookie: {
      maxAge: rememberMe ? sessionConfig.sessionTimeout : undefined,
      secure: !WG_ENV.INSECURE,
    },
  });
}

export async function getWGSession(event: H3Event) {
  const sessionConfig = await Database.general.getSessionConfig();
  return getSession<WGSession>(event, {
    password: sessionConfig.sessionPassword,
    name,
    cookie: {
      secure: !WG_ENV.INSECURE,
    },
  });
}

export async function useWGUserSession(event: H3Event) {
  const sessionConfig = await Database.general.getSessionConfig();
  return useSession<WGSession>(event, {
    password: sessionConfig.sessionPassword,
    name: userSessionName,
    cookie: {
      secure: !WG_ENV.INSECURE,
    },
  });
}

export async function getWGUserSession(event: H3Event) {
  const sessionConfig = await Database.general.getSessionConfig();
  return getSession<WGSession>(event, {
    password: sessionConfig.sessionPassword,
    name: userSessionName,
    cookie: {
      secure: !WG_ENV.INSECURE,
    },
  });
}

/**
 * @throws
 */
export async function getCurrentUser(event: H3Event) {
  // If principal was already resolved by middleware, use it directly
  const principal = event.context.principal;
  if (principal) {
    return principal.user;
  }

  const session = await getWGSession(event);

  const authorization = getHeader(event, 'Authorization');

  let user: UserType | undefined = undefined;
  if (session.data.userId) {
    // Handle if authenticating using Session
    user = await Database.users.get(session.data.userId);
  } else if (authorization) {
    // Handle if authenticating using Header
    const [method, value] = authorization.split(' ');

    if (method === 'Bearer' && value) {
      // Bearer token → lookup api_token by hash
      const tokens = await Database.apiTokens.getAll();
      const now = Date.now();

      for (const tokenRecord of tokens) {
        if (tokenRecord.expiresAt && tokenRecord.expiresAt.getTime() < now) {
          continue;
        }

        const valid = await isPasswordValid(value, tokenRecord.tokenHash);
        if (valid) {
          user = await Database.users.get(tokenRecord.userId);
          if (user) {
            await Database.apiTokens.updateLastUsed(tokenRecord.id);
          }
          break;
        }
      }

      if (!user) {
        throw createError({
          statusCode: 401,
          statusMessage: 'Invalid Bearer token',
        });
      }
    } else if (method === 'Basic' && value) {
      const basicValue = Buffer.from(value, 'base64').toString('utf-8');

      // Split by first ":"
      const index = basicValue.indexOf(':');
      const username = basicValue.substring(0, index);
      const password = basicValue.substring(index + 1);

      if (!username || !password) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Invalid Basic Authorization',
        });
      }

      const foundUser = await Database.users.getByUsername(username);

      if (!foundUser) {
        throw createError({
          statusCode: 401,
          statusMessage: 'Session failed',
        });
      }

      const userHashPassword = foundUser.password;
      const passwordValid = await isPasswordValid(password, userHashPassword);

      if (!passwordValid) {
        throw createError({
          statusCode: 401,
          statusMessage: 'Session failed',
        });
      }
      user = foundUser;
    } else {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid Authorization',
      });
    }
  } else {
    throw createError({
      statusCode: 401,
      statusMessage: 'Session failed. No Authorization',
    });
  }

  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Session failed. User not found',
    });
  }

  if (!user.enabled) {
    throw createError({
      statusCode: 403,
      statusMessage: 'User is disabled',
    });
  }

  return user;
}
