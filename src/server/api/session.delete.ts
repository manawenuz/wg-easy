import { parseCookies } from 'h3';

export default defineEventHandler(async (event) => {
  const cookies = parseCookies(event);
  const hasAdmin = 'wg-easy' in cookies;
  const hasUser = 'wg-user-session' in cookies;

  if (!hasAdmin && !hasUser) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not logged in',
    });
  }

  const cleared: string[] = [];

  if (hasAdmin) {
    try {
      const session = await useWGSession(event);
      await session.clear();
      cleared.push('admin');
    } catch {
      // ignore
    }
  }

  if (hasUser) {
    try {
      const userSession = await useWGUserSession(event);
      await userSession.clear();
      cleared.push('user');
    } catch {
      // ignore
    }
  }

  SERVER_DEBUG(`Deleted sessions: ${cleared.join(', ')}`);
  return { success: true, cleared };
});
