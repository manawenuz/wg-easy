import { eq, desc, sql, and, lt, inArray, gte, lte } from 'drizzle-orm';
import { usageSample } from './schema';
import type { DBType } from '#db/sqlite';

export class UsageSampleService {
  #db: DBType;

  constructor(db: DBType) {
    this.#db = db;
  }

  async getAll() {
    return this.#db.query.usageSample.findMany();
  }

  async getByClientId(clientId: ID) {
    return this.#db.query.usageSample.findMany({
      where: eq(usageSample.clientId, clientId),
    });
  }

  async insert(data: {
    clientId: ID;
    rxBytes: number;
    txBytes: number;
    ts: Date;
  }) {
    return this.#db.insert(usageSample).values(data);
  }

  async lastForClient(clientId: ID) {
    const rows = await this.#db
      .select()
      .from(usageSample)
      .where(eq(usageSample.clientId, clientId))
      .orderBy(desc(usageSample.ts))
      .limit(1);
    return rows[0] ?? null;
  }

  async aggregateHourly(cutoff: Date) {
    return this.#db
      .select({
        clientId: usageSample.clientId,
        hour: sql<string>`strftime('%Y-%m-%d %H:00:00', ${usageSample.ts} / 1000, 'unixepoch')`,
        rxBytes: sql<number>`sum(${usageSample.rxBytes})`,
        txBytes: sql<number>`sum(${usageSample.txBytes})`,
      })
      .from(usageSample)
      .where(lt(usageSample.ts, cutoff))
      .groupBy(
        usageSample.clientId,
        sql`strftime('%Y-%m-%d %H:00:00', ${usageSample.ts} / 1000, 'unixepoch')`
      );
  }

  async deleteOlderThan(cutoff: Date) {
    return this.#db
      .delete(usageSample)
      .where(lt(usageSample.ts, cutoff))
      .execute();
  }

  async getForClients(clientIds: ID[], periodStart: Date, periodEnd: Date) {
    if (clientIds.length === 0) return [];
    return this.#db.query.usageSample.findMany({
      where: and(
        inArray(usageSample.clientId, clientIds),
        gte(usageSample.ts, periodStart),
        lte(usageSample.ts, periodEnd)
      ),
    });
  }
}
