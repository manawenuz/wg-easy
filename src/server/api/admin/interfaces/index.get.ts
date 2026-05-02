export default defineEventHandler(async (event) => {
  await requirePermission(event, 'router:read');

  const query = getQuery(event);
  const routerId = query.routerId ? Number(query.routerId) : undefined;

  if (routerId !== undefined && !Number.isNaN(routerId)) {
    const interfaces = await Database.interfaces.getByRouterId(routerId);
    return interfaces.map((iface) => ({
      ...iface,
      privateKey: undefined,
    }));
  }

  const interfaces = await Database.interfaces.getAll();
  return interfaces.map((iface) => ({
    ...iface,
    privateKey: undefined,
  }));
});
