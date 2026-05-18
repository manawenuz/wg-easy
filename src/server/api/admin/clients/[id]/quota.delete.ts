export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin:settings');

  const id = Number(getRouterParam(event, 'id'));
  if (!id || Number.isNaN(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid client ID',
    });
  }

  const client = await Database.clients.get(id);
  if (!client) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Client not found',
    });
  }

  throw createError({
    statusCode: 410,
    statusMessage: 'Per-client quota management has been removed. Use DELETE /api/admin/users/{userId}/quota instead.',
  });
});
