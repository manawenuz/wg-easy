export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin:settings');

  const id = Number(getRouterParam(event, 'id'));
  if (!id || Number.isNaN(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid client ID',
    });
  }

  const quota = await Database.quotas.getByClientId(id);

  if (!quota) {
    return null;
  }

  return {
    clientId: quota.clientId,
    limitBytes: quota.limitBytes,
    usedBytes: quota.usedBytes,
    period: quota.period,
    periodStart: quota.periodStart,
    periodEnd: quota.periodEnd,
    autoDisable: quota.autoDisable,
    disabledByQuotaAt: quota.disabledByQuotaAt,
  };
});
