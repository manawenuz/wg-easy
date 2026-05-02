export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin:settings');

  const principal = event.context.principal!;
  const tokenId = Number(getRouterParam(event, 'id'));

  if (!tokenId || Number.isNaN(tokenId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid token ID',
    });
  }

  const token = await Database.apiTokens.findById(tokenId);

  if (!token || token.userId !== principal.user.id) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Token not found',
    });
  }

  await Database.apiTokens.delete(tokenId);

  return { ok: true };
});
