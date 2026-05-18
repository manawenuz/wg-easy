export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin:settings');

  const id = Number(getRouterParam(event, 'id'));
  if (!id || Number.isNaN(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid user ID',
    });
  }

  const rootId = await Database.users.getRootUserId(id);
  const quota = await Database.quotas.getByUserId(rootId);

  if (!quota) {
    return null;
  }

  return {
    userId: quota.userId,
    limitBytes: quota.limitBytes,
    usedBytes: quota.usedBytes,
    period: quota.period,
    periodStart: quota.periodStart,
    periodEnd: quota.periodEnd,
    autoDisable: quota.autoDisable,
    disabledByQuotaAt: quota.disabledByQuotaAt,
    inheritedFromUserId: id !== rootId ? rootId : undefined,
  };
});
