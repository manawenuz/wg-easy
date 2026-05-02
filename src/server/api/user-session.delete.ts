export default defineEventHandler(async (event) => {
  const session = await useWGUserSession(event);

  if (!session.data.userId) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not logged in',
    });
  }

  await session.clear();
  return { success: true };
});
