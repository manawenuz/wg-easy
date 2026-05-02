import { eq } from 'drizzle-orm';
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
}
