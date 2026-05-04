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

  const client = await Database.clients.get(principal.clientId);
  if (!client) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Client not found',
    });
  }

  return {
    user: {
      id: client.id,
      name: client.name,
      email: principal.user.email,
    } satisfies Pick<SharedPublicUser, 'id' | 'name' | 'email'>,
    clientsCount: 1,
  };
});
