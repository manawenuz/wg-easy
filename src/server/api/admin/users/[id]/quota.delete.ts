import { logAction } from '../../../../utils/audit';

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin:settings');

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

  if (user.parentUserId !== null) {
    const rootId = await Database.users.getRootUserId(id);
    throw createError({
      statusCode: 409,
      statusMessage: `quota_inherited`,
      data: { rootUserId: rootId },
    });
  }

  await Database.quotas.delete(id);

  await logAction(event, 'quota.delete', { userId: id });

  return { ok: true };
});
