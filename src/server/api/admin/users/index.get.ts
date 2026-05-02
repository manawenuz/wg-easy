export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin:users');

  const users = await Database.users.getAll();

  return users.map((u) => ({
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email,
    role: u.role,
    enabled: u.enabled,
    totpVerified: u.totpVerified,
    createdAt: u.createdAt,
  }));
});
