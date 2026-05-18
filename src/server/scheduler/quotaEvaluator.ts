import { getEngine } from '../engines/registry';
import { quotaService } from '../services/quotaService';

export async function runQuotaEvaluator() {
  const overLimit = await quotaService.evaluateAll();
  if (overLimit.length === 0) return;

  const iface = await Database.interfaces.get();
  const engine = getEngine(iface.engineType);

  for (const q of overLimit) {
    const familyIds = await Database.users.getFamilyMemberIds(q.userId);
    const familyClients = await Database.clients.getForUsers(familyIds);
    const enabledClients = familyClients.filter((c) => c.enabled);
    if (enabledClients.length === 0) continue;

    const disabledClientIds: number[] = [];
    let anySuccess = false;

    for (const client of enabledClients) {
      try {
        await Database.clients.toggle(client.id, false);
        await engine.disablePeer(iface, client.publicKey);
        disabledClientIds.push(client.id);
        anySuccess = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await Database.auditLogs.create({
          action: 'quota.exceeded',
          target: { clientId: client.id, userId: q.userId, error: message },
          result: 'error',
        });
      }
    }

    if (anySuccess) {
      await quotaService.markDisabledByQuota(q.userId);
      await Database.auditLogs.create({
        action: 'family.quota.exceeded',
        target: {
          rootUserId: q.userId,
          usedBytes: q.usedBytes,
          limitBytes: q.limitBytes,
          disabledClientIds,
        },
        result: 'ok',
      });
    }
  }
}
