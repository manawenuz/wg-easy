import { eq, sql, and, lte, gte } from 'drizzle-orm';
import { quota } from './schema';
import type { DBType } from '#db/sqlite';
import type { QuotaType } from './types';

export class QuotaService {
  #db: DBType;

  constructor(db: DBType) {
    this.#db = db;
  }

  async getAll() {
    return this.#db.query.quota.findMany();
  }

  async getByClientId(clientId: ID) {
    return this.#db.query.quota.findFirst({
      where: eq(quota.clientId, clientId),
    });
  }

  async create(data: {
    clientId: ID;
    limitBytes: number;
    period: 'daily' | 'weekly' | 'monthly';
    periodStart: Date;
    periodEnd: Date;
    autoDisable?: boolean;
  }) {
    return this.#db.insert(quota).values({
      ...data,
      autoDisable: data.autoDisable ?? true,
      usedBytes: 0,
    });
  }

  async update(clientId: ID, data: Partial<Omit<QuotaType, 'clientId'>>) {
    return this.#db
      .update(quota)
      .set(data)
      .where(eq(quota.clientId, clientId))
      .execute();
  }

  async delete(clientId: ID) {
    return this.#db.delete(quota).where(eq(quota.clientId, clientId)).execute();
  }

  async addUsage(clientId: ID, bytes: number) {
    return this.#db
      .update(quota)
      .set({ usedBytes: sql`${quota.usedBytes} + ${bytes}` })
      .where(eq(quota.clientId, clientId))
      .execute();
  }

  async findOverLimit() {
    const now = new Date();
    return this.#db.query.quota.findMany({
      where: and(
        sql`${quota.usedBytes} >= ${quota.limitBytes}`,
        eq(quota.autoDisable, true),
        sql`${quota.disabledByQuotaAt} IS NULL`,
        lte(quota.periodStart, now),
        gte(quota.periodEnd, now)
      ),
    });
  }

  async findExpiredPeriods() {
    const now = new Date();
    return this.#db.query.quota.findMany({
      where: lte(quota.periodEnd, now),
    });
  }

  async markDisabledByQuota(clientId: ID) {
    return this.#db
      .update(quota)
      .set({ disabledByQuotaAt: new Date() })
      .where(eq(quota.clientId, clientId))
      .execute();
  }

  async clearDisabledByQuota(clientId: ID) {
    return this.#db
      .update(quota)
      .set({ disabledByQuotaAt: null })
      .where(eq(quota.clientId, clientId))
      .execute();
  }
}
