function getPeriodDates(period: 'daily' | 'weekly' | 'monthly'): {
  periodStart: Date;
  periodEnd: Date;
} {
  const now = new Date();
  const periodStart = new Date(now);
  periodStart.setMilliseconds(0);
  periodStart.setSeconds(0);
  periodStart.setMinutes(0);
  periodStart.setHours(0);

  const periodEnd = new Date(periodStart);

  if (period === 'daily') {
    periodEnd.setDate(periodEnd.getDate() + 1);
  } else if (period === 'weekly') {
    const day = periodStart.getDay();
    periodStart.setDate(periodStart.getDate() - day);
    periodEnd.setDate(periodStart.getDate() + 7);
  } else if (period === 'monthly') {
    periodStart.setDate(1);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    periodEnd.setDate(1);
  }

  return { periodStart, periodEnd };
}

export class QuotaService {
  async getEffectiveQuota(clientId: ID) {
    const client = await Database.clients.get(clientId);
    if (!client) {
      return null;
    }

    // Check if client has a traffic group with quota
    if (client.trafficGroupId) {
      const group = await Database.trafficGroups.get(client.trafficGroupId);
      if (group && group.quotaLimitBytes !== null && group.quotaPeriod) {
        // Get or create quota tracking for this client based on group settings
        const existing = await Database.quotas.getByClientId(clientId);
        if (existing) {
          return {
            ...existing,
            limitBytes: group.quotaLimitBytes,
            period: group.quotaPeriod,
            autoDisable: group.quotaAutoDisable ?? true,
            source: 'group' as const,
          };
        }
        // Return group settings even if no tracking exists yet
        return {
          clientId,
          limitBytes: group.quotaLimitBytes,
          period: group.quotaPeriod,
          autoDisable: group.quotaAutoDisable ?? true,
          usedBytes: 0,
          source: 'group' as const,
        };
      }
    }

    // Fall back to per-client quota
    const perClientQuota = await Database.quotas.getByClientId(clientId);
    if (perClientQuota) {
      return {
        ...perClientQuota,
        source: 'client' as const,
      };
    }

    return null;
  }

  async getQuota(clientId: ID) {
    return Database.quotas.getByClientId(clientId);
  }

  async setQuota(
    clientId: ID,
    data: {
      limitBytes: number;
      period: 'daily' | 'weekly' | 'monthly';
      autoDisable?: boolean;
    }
  ) {
    const existing = await Database.quotas.getByClientId(clientId);
    const { periodStart, periodEnd } = getPeriodDates(data.period);

    if (existing) {
      await Database.quotas.update(clientId, {
        limitBytes: data.limitBytes,
        period: data.period,
        autoDisable: data.autoDisable ?? true,
        periodStart,
        periodEnd,
      });
    } else {
      await Database.quotas.create({
        clientId,
        limitBytes: data.limitBytes,
        period: data.period,
        periodStart,
        periodEnd,
        autoDisable: data.autoDisable ?? true,
      });
    }
  }

  async deleteQuota(clientId: ID) {
    await Database.quotas.delete(clientId);
  }

  async addUsage(clientId: ID, rxBytes: number, txBytes: number) {
    const totalBytes = rxBytes + txBytes;
    if (totalBytes <= 0) return;

    const effectiveQuota = await this.getEffectiveQuota(clientId);
    if (!effectiveQuota) return;

    // Ensure quota tracking exists in database
    const existing = await Database.quotas.getByClientId(clientId);
    if (!existing && effectiveQuota.source === 'group') {
      // Create quota tracking for group-based quota
      const { periodStart, periodEnd } = getPeriodDates(effectiveQuota.period);
      await Database.quotas.create({
        clientId,
        limitBytes: effectiveQuota.limitBytes,
        period: effectiveQuota.period,
        periodStart,
        periodEnd,
        autoDisable: effectiveQuota.autoDisable,
      });
    }

    await Database.quotas.addUsage(clientId, totalBytes);
  }

  async findOverLimit() {
    // Get all clients
    const clients = await Database.clients.getAll();
    const overLimit = [];

    for (const client of clients) {
      const effectiveQuota = await this.getEffectiveQuota(client.id);
      if (!effectiveQuota) continue;

      // Check if over limit
      if (effectiveQuota.usedBytes > effectiveQuota.limitBytes) {
        overLimit.push({
          clientId: client.id,
          limitBytes: effectiveQuota.limitBytes,
          usedBytes: effectiveQuota.usedBytes,
          autoDisable: effectiveQuota.autoDisable,
        });
      }
    }

    return overLimit;
  }

  async findExpiredPeriods() {
    return Database.quotas.findExpiredPeriods();
  }

  async resetPeriod(quotaRow: {
    clientId: ID;
    period: 'daily' | 'weekly' | 'monthly';
  }) {
    const { periodStart, periodEnd } = getPeriodDates(quotaRow.period);
    await Database.quotas.update(quotaRow.clientId, {
      usedBytes: 0,
      periodStart,
      periodEnd,
      disabledByQuotaAt: null,
    });
  }

  async markDisabledByQuota(clientId: ID) {
    await Database.quotas.markDisabledByQuota(clientId);
  }

  async clearDisabledByQuota(clientId: ID) {
    await Database.quotas.clearDisabledByQuota(clientId);
  }

  async insertUsageSample(
    clientId: ID,
    rxBytes: number,
    txBytes: number,
    ts = new Date()
  ) {
    await Database.usageSamples.insert({ clientId, rxBytes, txBytes, ts });
  }

  async getLastUsageSample(clientId: ID) {
    return Database.usageSamples.lastForClient(clientId);
  }

  async deleteOldUsageSamples(cutoff: Date) {
    await Database.usageSamples.deleteOlderThan(cutoff);
  }
}

export const quotaService = new QuotaService();
