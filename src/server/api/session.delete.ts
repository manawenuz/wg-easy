export default defineEventHandler(async (event) => {
  // Try admin session first, then user session
  let sessionId: string | undefined;

  try {
    const session = await useWGSession(event);
    if (session.id) {
      sessionId = session.id;
      await session.clear();
    }
  } catch {
    // ignore
  }

  if (!sessionId) {
    try {
      const userSession = await useWGUserSession(event);
      if (userSession.id) {
        sessionId = userSession.id;
        await userSession.clear();
      }
    } catch {
      // ignore
    }
  }

  if (!sessionId) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not logged in',
    });
  }

  SERVER_DEBUG(`Deleted Session: ${sessionId}`);
  return { success: true };
});
