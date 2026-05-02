import { quotaService } from '../services/quotaService';

export async function runUsageRollup() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Delete raw samples older than 7 days
  await quotaService.deleteOldUsageSamples(sevenDaysAgo);
}
