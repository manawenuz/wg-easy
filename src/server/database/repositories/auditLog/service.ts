import { eq, desc, and, gte, lte, sql } from 'drizzle-orm';
import { auditLog } from './schema';
import type { DBType } from '#db/sqlite';

export class AuditLogService {
  #db: DBType;

  constructor(db: DBType) {
    this.#db = db;
  }

  async getAll() {
    return this.#db.query.auditLog.findMany();
  }

  async getByActorUserId(actorUserId: ID) {
    return this.#db.query.auditLog.findMany({
      where: eq(auditLog.actorUserId, actorUserId),
    });
  }

  async create({
    actorUserId,
    action,
    target,
    result,
  }: {
    actorUserId?: ID | null;
    action: string;
    target?: object;
    result: 'ok' | 'error';
  }) {
    return this.#db.insert(auditLog).values({
      actorUserId: actorUserId ?? null,
      action,
      target: target ? JSON.stringify(target) : null,
      result,
    });
  }

  async getAllPaginated({
    actorUserId,
    action,
    target,
    since,
    until,
    limit = 50,
    offset = 0,
  }: {
    actorUserId?: ID;
    action?: string;
    target?: string;
    since?: Date;
    until?: Date;
    limit?: number;
    offset?: number;
  } = {}) {
    const conditions = [];

    if (actorUserId !== undefined) {
      conditions.push(eq(auditLog.actorUserId, actorUserId));
    }
    if (action) {
      conditions.push(eq(auditLog.action, action));
    }
    if (target) {
      conditions.push(sql`${auditLog.target} LIKE ${`%${target}%`}`);
    }
    if (since) {
      conditions.push(gte(auditLog.ts, since));
    }
    if (until) {
      conditions.push(lte(auditLog.ts, until));
    }

    const where =
      conditions.length > 0 ? and(...conditions) : undefined;

    const items = await this.#db.query.auditLog.findMany({
      where,
      orderBy: desc(auditLog.ts),
      limit,
      offset,
    });

    const countResult = await this.#db
      .select({ count: sql<number>`count(*)` })
      .from(auditLog)
      .where(where)
      .execute();

    const total = countResult[0]?.count ?? 0;

    return { items, total };
  }
}
