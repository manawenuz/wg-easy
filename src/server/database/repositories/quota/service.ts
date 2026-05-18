import { eq, sql, and, lte, gte } from 'drizzle-orm';
import { userQuota } from './schema';
import type { UserQuotaType } from './types';
import type { DBType } from '#db/sqlite';

export class UserQuotaService {
  #db: DBType;

  constructor(db: DBType) {
    this.#db = db;
  }

  async getAll() {
    return this.#db.query.userQuota.findMany();
  }

  async getByUserId(userId: ID) {
    return this.#db.query.userQuota.findFirst({
      where: eq(userQuota.userId, userId),
    });
  }

  async create(data: {
    userId: ID;
    limitBytes: number;
    period: 'daily' | 'weekly' | 'monthly';
    periodStart: Date;
    periodEnd: Date;
    autoDisable?: boolean;
  }) {
    return this.#db.insert(userQuota).values({
      ...data,
      autoDisable: data.autoDisable ?? true,
      usedBytes: 0,
    });
  }

  async update(userId: ID, data: Partial<Omit<UserQuotaType, 'userId'>>) {
    return this.#db
      .update(userQuota)
      .set(data)
      .where(eq(userQuota.userId, userId))
      .execute();
  }

  async delete(userId: ID) {
    return this.#db.delete(userQuota).where(eq(userQuota.userId, userId)).execute();
  }

  async addUsage(userId: ID, bytes: number) {
    return this.#db
      .update(userQuota)
      .set({ usedBytes: sql`${userQuota.usedBytes} + ${bytes}` })
      .where(eq(userQuota.userId, userId))
      .execute();
  }

  async findOverLimit() {
    const now = new Date();
    return this.#db.query.userQuota.findMany({
      where: and(
        sql`${userQuota.usedBytes} >= ${userQuota.limitBytes}`,
        eq(userQuota.autoDisable, true),
        sql`${userQuota.disabledByQuotaAt} IS NULL`,
        lte(userQuota.periodStart, now),
        gte(userQuota.periodEnd, now)
      ),
    });
  }

  async findExpiredPeriods() {
    const now = new Date();
    return this.#db.query.userQuota.findMany({
      where: lte(userQuota.periodEnd, now),
    });
  }

  async markDisabledByQuota(userId: ID) {
    return this.#db
      .update(userQuota)
      .set({ disabledByQuotaAt: new Date() })
      .where(eq(userQuota.userId, userId))
      .execute();
  }

  async clearDisabledByQuota(userId: ID) {
    return this.#db
      .update(userQuota)
      .set({ disabledByQuotaAt: null })
      .where(eq(userQuota.userId, userId))
      .execute();
  }
}
