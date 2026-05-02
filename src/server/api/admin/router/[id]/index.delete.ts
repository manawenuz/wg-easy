export default defineEventHandler(async (event) => {
  await requirePermission(event, 'router:admin');

  const id = Number(getRouterParam(event, 'id'));
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid router ID' });
  }

  const existing = await Database.routers.get(id);
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Router not found' });
  }

  const interfaces = await Database.interfaces.getByRouterId(id);
  if (interfaces.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Cannot delete router with attached interfaces',
    });
  }

  await Database.routers.delete(id);

  await logAction(event, 'router.delete', { routerId: id, name: existing.name });

  return { ok: true };
});
