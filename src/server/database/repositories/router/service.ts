import { eq } from 'drizzle-orm';
import { router } from './schema';
import type { DBType } from '#db/sqlite';

export class RouterService {
  #db: DBType;

  constructor(db: DBType) {
    this.#db = db;
  }

  async getAll() {
    return this.#db.query.router.findMany();
  }

  async get(id: ID) {
    return this.#db.query.router.findFirst({
      where: eq(router.id, id),
    });
  }
}
