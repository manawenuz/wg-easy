export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const routerId = query.routerId ? Number(query.routerId) : undefined;

  if (query.routerId && Number.isNaN(routerId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid router ID',
    });
  }

  if (routerId !== undefined) {
    await requirePermission(event, 'router:read', { routerId });
    const interfaces = await Database.interfaces.getByRouterId(routerId);
    return interfaces.map((iface) => ({
      ...iface,
      privateKey: undefined,
    }));
  }

  const allowedRouterIds = await getAllowedRouterIds(event, 'router:read');
  const interfaces = (await Database.interfaces.getAll()).filter(
    (iface) => allowedRouterIds === null || allowedRouterIds.has(iface.routerId)
  );
  return interfaces.map((iface) => ({
    ...iface,
    privateKey: undefined,
  }));
});
