import { getEngine } from '../engines/registry';
import { quotaService } from '../services/quotaService';

export async function runPeriodResetter() {
  const expired = await quotaService.findExpiredPeriods();
  if (expired.length === 0) return;

  const iface = await Database.interfaces.get();
  const engine = getEngine(iface.engineType);

  for (const q of expired) {
    const wasDisabledByQuota = q.disabledByQuotaAt !== null;

    await quotaService.resetPeriod({
      clientId: q.clientId,
      period: q.period,
    });

    if (!wasDisabledByQuota) continue;

    const client = await Database.clients.get(q.clientId);
    if (!client) continue;

    // Check if there was a manual disable after the quota disable
    const { items: manualDisableAfter } = await Database.auditLogs.getAllPaginated({
      action: 'client.disabled',
      since: q.disabledByQuotaAt ?? undefined,
      limit: 1,
      offset: 0,
    });

    // If no manual disable after quota disable, re-enable the peer
    if (manualDisableAfter.length === 0) {
      try {
        await Database.clients.toggle(q.clientId, true);
        await engine.enablePeer(iface, client.publicKey);
        await Database.auditLogs.create({
          action: 'quota.periodReset',
          target: { clientId: q.clientId },
          result: 'ok',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await Database.auditLogs.create({
          action: 'quota.periodReset',
          target: { clientId: q.clientId, error: message },
          result: 'error',
        });
      }
    }
  }
}
