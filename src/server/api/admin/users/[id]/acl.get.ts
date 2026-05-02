export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin:users');

  const id = Number(getRouterParam(event, 'id'));
  if (!id || Number.isNaN(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid user ID',
    });
  }

  const acls = await Database.adminRouterAcls.getByUserId(id);
  const routers = await Database.routers.getAll();

  return {
    acls: acls.map((a) => ({
      routerId: a.routerId,
      permission: a.permission,
    })),
    routers: routers.map((r) => ({
      id: r.id,
      name: r.name,
    })),
  };
});
