import { eq, and } from 'drizzle-orm';
import { adminRouterAcl } from './schema';
import type { DBType } from '#db/sqlite';

export class AdminRouterAclService {
  #db: DBType;

  constructor(db: DBType) {
    this.#db = db;
  }

  async getAll() {
    return this.#db.query.adminRouterAcl.findMany();
  }

  async getByUserAndRouter(userId: ID, routerId: ID) {
    return this.#db.query.adminRouterAcl.findFirst({
      where: and(
        eq(adminRouterAcl.userId, userId),
        eq(adminRouterAcl.routerId, routerId)
      ),
    });
  }

  async getByUserId(userId: ID) {
    return this.#db.query.adminRouterAcl.findMany({
      where: eq(adminRouterAcl.userId, userId),
    });
  }

  async replaceForUser(
    userId: ID,
    rows: { routerId: ID; permission: 'read' | 'write' | 'admin' }[]
  ) {
    return this.#db.transaction(async (tx) => {
      await tx
        .delete(adminRouterAcl)
        .where(eq(adminRouterAcl.userId, userId))
        .execute();

      if (rows.length > 0) {
        await tx.insert(adminRouterAcl).values(
          rows.map((r) => ({
            userId,
            routerId: r.routerId,
            permission: r.permission,
          }))
        );
      }
    });
  }
}
