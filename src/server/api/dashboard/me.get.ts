export default defineEventHandler(async (event) => {
  await requirePermission(event, 'dashboard:self');

  const principal = event.context.principal!;

  if (principal.kind !== 'user') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
    });
  }

  const user = await Database.users.get(principal.dashboardUserId);
  if (!user) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User not found',
    });
  }

  const clients = await Database.clients.getForUser(principal.dashboardUserId);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
    clientsCount: clients.length,
  };
});
