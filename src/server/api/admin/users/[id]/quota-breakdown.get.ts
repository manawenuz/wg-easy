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

  const familyIds = await Database.users.getFamilyMemberIds(rootId);
  const familyClients = await Database.clients.getForUsers(familyIds);

  // Build clientId -> userId map for attribution
  const clientIdToUserId = new Map<number, number>();
  const clientIdsByUser = new Map<number, number[]>();
  for (const c of familyClients) {
    clientIdToUserId.set(c.id, c.userId);
    const list = clientIdsByUser.get(c.userId) ?? [];
    list.push(c.id);
    clientIdsByUser.set(c.userId, list);
  }

  // Aggregate usage samples by user for the current period
  const usageByUser = new Map<number, number>();
  const allClientIds = familyClients.map((c) => c.id);
  if (allClientIds.length > 0) {
    const samples = await Database.usageSamples.getForClients(
      allClientIds,
      quota.periodStart,
      quota.periodEnd
    );
    for (const s of samples) {
      const userId = clientIdToUserId.get(s.clientId);
      if (userId !== undefined) {
        usageByUser.set(
          userId,
          (usageByUser.get(userId) ?? 0) + s.rxBytes + s.txBytes
        );
      }
    }
  }

  // Build member rows
  const members = [];
  for (const userId of familyIds) {
    const user = await Database.users.get(userId);
    members.push({
      userId,
      name: user?.name ?? `User ${userId}`,
      usedBytes: usageByUser.get(userId) ?? 0,
      clientIds: clientIdsByUser.get(userId) ?? [],
    });
  }

  return {
    rootUserId: rootId,
    periodStart: quota.periodStart,
    periodEnd: quota.periodEnd,
    limitBytes: quota.limitBytes,
    members,
  };
});
