import { quotaService } from '../services/quotaService';

export async function runPeriodResetter() {
  const expired = await quotaService.findExpiredPeriods();
  if (expired.length === 0) return;

  const now = new Date();

  for (const q of expired) {
    const wasDisabledByQuota = q.disabledByQuotaAt !== null;

    await quotaService.resetPeriodIfNeeded(q.userId, now);

    if (wasDisabledByQuota) {
      await Database.auditLogs.create({
        action: 'quota.periodReset',
        target: { userId: q.userId },
        result: 'ok',
      });
    }
  }
}
