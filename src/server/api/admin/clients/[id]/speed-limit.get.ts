export default defineEventHandler(async (event) => {
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
  await requireClientPermission(event, 'client:read', client);

  const limit = await Database.speedLimits.getByClientId(id);
  if (!limit) {
    return { upKbps: 0, downKbps: 0 };
  }

  return { upKbps: limit.upKbps, downKbps: limit.downKbps };
});
