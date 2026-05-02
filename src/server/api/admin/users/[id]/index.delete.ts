import { logAction } from '../../../../utils/audit';

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin:users');

  const id = Number(getRouterParam(event, 'id'));
  if (!id || Number.isNaN(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid user ID',
    });
  }

  const principal = event.context.principal!;

  if (id === principal.user.id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Cannot delete yourself',
    });
  }

  const target = await Database.users.get(id);
  if (!target) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User not found',
    });
  }

  await Database.users.delete(id);

  await logAction(event, 'user.delete', { userId: id, username: target.username });

  return { ok: true };
});
