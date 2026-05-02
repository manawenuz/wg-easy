import { eq } from 'drizzle-orm';
import { quota } from './schema';
import type { DBType } from '#db/sqlite';

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
}
