export default defineEventHandler(async (event) => {
  await requirePermission(event, 'router:read');

  const routers = await Database.routers.getAll();
  return routers.map((r) => ({
    ...r,
    credentialsEncrypted: undefined,
  }));
});
