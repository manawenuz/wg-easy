import { eq } from 'drizzle-orm';
import { routePolicy } from './schema';
import type { DBType } from '#db/sqlite';

export class RoutePolicyService {
  #db: DBType;

  constructor(db: DBType) {
    this.#db = db;
  }

  async getAll() {
    return this.#db.query.routePolicy.findMany();
  }

  async getByInterfaceId(interfaceId: string) {
    return this.#db.query.routePolicy.findMany({
      where: eq(routePolicy.interfaceId, interfaceId),
    });
  }
}
