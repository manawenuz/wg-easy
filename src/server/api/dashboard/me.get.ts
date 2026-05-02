import type { SharedPublicUser } from '~~/shared/utils/permissions';

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'dashboard:self');

  const principal = event.context.principal!;

  if (principal.kind !== 'user') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
    });
  }
  const user = principal.user;

  const clients = await Database.clients.getForUser(user.id);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    } satisfies Pick<SharedPublicUser, 'id' | 'name' | 'email'>,
    clientsCount: clients.length,
  };
});
