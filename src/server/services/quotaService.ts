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
  private async _resolveRootUserId(userId: ID): Promise<ID> {
    return Database.users.getRootUserId(userId);
  }

  async getForUser(userId: ID) {
    const rootId = await this._resolveRootUserId(userId);
    const userQuota = await Database.quotas.getByUserId(rootId);
    if (!userQuota) return null;

    // Check if root user has a traffic group with quota
    const user = await Database.users.get(rootId);
    if (user?.defaultTrafficGroupId) {
      const group = await Database.trafficGroups.get(user.defaultTrafficGroupId);
      if (group && group.quotaLimitBytes !== null && group.quotaPeriod) {
        return {
          ...userQuota,
          limitBytes: group.quotaLimitBytes,
          period: group.quotaPeriod,
          autoDisable: group.quotaAutoDisable ?? true,
          source: 'group' as const,
        };
      }
    }

    return {
      ...userQuota,
      source: 'user' as const,
    };
  }

  async setForUser(
    userId: ID,
    data: {
      limitBytes: number;
      period: 'daily' | 'weekly' | 'monthly';
      autoDisable?: boolean;
    }
  ) {
    const rootId = await this._resolveRootUserId(userId);
    const existing = await Database.quotas.getByUserId(rootId);
    const { periodStart, periodEnd } = getPeriodDates(data.period);

    if (existing) {
      await Database.quotas.update(rootId, {
        limitBytes: data.limitBytes,
        period: data.period,
        autoDisable: data.autoDisable ?? true,
        periodStart,
        periodEnd,
      });
    } else {
      await Database.quotas.create({
        userId: rootId,
        limitBytes: data.limitBytes,
        period: data.period,
        periodStart,
        periodEnd,
        autoDisable: data.autoDisable ?? true,
      });
    }
  }

  async clearForUser(userId: ID) {
    const rootId = await this._resolveRootUserId(userId);
    await Database.quotas.delete(rootId);
  }

  async addBytes(userId: ID, bytes: number) {
    if (bytes <= 0) return;

    const rootId = await this._resolveRootUserId(userId);
    const effectiveQuota = await this.getForUser(rootId);
    if (!effectiveQuota) return;

    // Ensure quota tracking exists in database
    const existing = await Database.quotas.getByUserId(rootId);
    if (!existing && effectiveQuota.source === 'group') {
      const { periodStart, periodEnd } = getPeriodDates(effectiveQuota.period);
      await Database.quotas.create({
        userId: rootId,
        limitBytes: effectiveQuota.limitBytes,
        period: effectiveQuota.period,
        periodStart,
        periodEnd,
        autoDisable: effectiveQuota.autoDisable,
      });
    }

    await Database.quotas.addUsage(rootId, bytes);
  }

  async findExpiredPeriods() {
    return Database.quotas.findExpiredPeriods();
  }

  async evaluateAll() {
    const userQuotas = await Database.quotas.findOverLimit();
    const result: {
      userId: ID;
      overLimit: boolean;
      autoDisable: boolean;
      usedBytes: number;
      limitBytes: number;
    }[] = [];

    for (const uq of userQuotas) {
      result.push({
        userId: uq.userId,
        overLimit: true,
        autoDisable: uq.autoDisable,
        usedBytes: uq.usedBytes,
        limitBytes: uq.limitBytes,
      });
    }

    return result;
  }

  async resetPeriodIfNeeded(userId: ID, now: Date) {
    const rootId = await this._resolveRootUserId(userId);
    const uq = await Database.quotas.getByUserId(rootId);
    if (!uq) return false;
    if (uq.periodEnd > now) return false;

    const { periodStart, periodEnd } = getPeriodDates(uq.period);
    await Database.quotas.update(rootId, {
      usedBytes: 0,
      periodStart,
      periodEnd,
      disabledByQuotaAt: null,
    });
    return true;
  }

  async markDisabledByQuota(userId: ID) {
    const rootId = await this._resolveRootUserId(userId);
    await Database.quotas.markDisabledByQuota(rootId);
  }

  async clearDisabledByQuota(userId: ID) {
    const rootId = await this._resolveRootUserId(userId);
    await Database.quotas.clearDisabledByQuota(rootId);
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
