import { getEngine } from '../engines/registry';
import { quotaService } from '../services/quotaService';

export async function runQuotaEvaluator() {
  const overLimit = await quotaService.findOverLimit();
  if (overLimit.length === 0) return;

  const iface = await Database.interfaces.get();
  const engine = getEngine(iface.engineType);

  for (const q of overLimit) {
    const client = await Database.clients.get(q.clientId);
    if (!client || !client.enabled) continue;

    try {
      await engine.disablePeer(iface, client.publicKey);
      await quotaService.markDisabledByQuota(q.clientId);
      await Database.auditLogs.create({
        action: 'quota.exceeded',
        target: { clientId: q.clientId, usedBytes: q.usedBytes, limitBytes: q.limitBytes },
        result: 'ok',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await Database.auditLogs.create({
        action: 'quota.exceeded',
        target: { clientId: q.clientId, error: message },
        result: 'error',
      });
    }
  }
}
