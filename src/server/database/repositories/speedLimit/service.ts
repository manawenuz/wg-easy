import { eq } from 'drizzle-orm';
import { speedLimit } from './schema';
import type { DBType } from '#db/sqlite';

export class SpeedLimitService {
  #db: DBType;

  constructor(db: DBType) {
    this.#db = db;
  }

  async getAll() {
    return this.#db.query.speedLimit.findMany();
  }

  async getByClientId(clientId: ID) {
    return this.#db.query.speedLimit.findFirst({
      where: eq(speedLimit.clientId, clientId),
    });
  }
}
