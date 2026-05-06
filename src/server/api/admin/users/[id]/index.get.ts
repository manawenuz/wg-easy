export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin:users');

  const id = Number(getRouterParam(event, 'id'));
  if (!id || Number.isNaN(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid user ID',
    });
  }

  const user = await Database.users.get(id);
  if (!user) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User not found',
    });
  }

  // Get sub-accounts
  const subAccounts = await Database.users.getSubAccounts(id);

  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    enabled: user.enabled,
    totpVerified: user.totpVerified,
    parentUserId: user.parentUserId,
    defaultTrafficGroupId: user.defaultTrafficGroupId,
    subAccounts: subAccounts.map((sub) => ({
      id: sub.id,
      username: sub.username,
      name: sub.name,
      email: sub.email,
    })),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
});
