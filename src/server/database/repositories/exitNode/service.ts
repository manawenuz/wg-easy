import { eq } from 'drizzle-orm';
import { exitNode } from './schema';
import type { DBType } from '#db/sqlite';

export class ExitNodeService {
  #db: DBType;

  constructor(db: DBType) {
    this.#db = db;
  }

  async getAll() {
    return this.#db.query.exitNode.findMany();
  }

  async getByRouterId(routerId: ID) {
    return this.#db.query.exitNode.findMany({
      where: eq(exitNode.routerId, routerId),
    });
  }
}
