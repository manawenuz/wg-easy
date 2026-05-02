import { eq, sql } from 'drizzle-orm';
import { speedLimit } from './schema';
import { client } from '../../schema';
import type { DBType } from '#db/sqlite';
import type { SpeedLimitType } from './types';

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

  async upsert(data: {
    clientId: ID;
    upKbps: number;
    downKbps: number;
  }) {
    const existing = await this.getByClientId(data.clientId);
    if (existing) {
      return this.#db
        .update(speedLimit)
        .set({
          upKbps: data.upKbps,
          downKbps: data.downKbps,
          appliedAt: new Date(),
        })
        .where(eq(speedLimit.clientId, data.clientId))
        .execute();
    }
    return this.#db.insert(speedLimit).values({
      ...data,
      appliedAt: new Date(),
    });
  }

  async delete(clientId: ID) {
    return this.#db
      .delete(speedLimit)
      .where(eq(speedLimit.clientId, clientId))
      .execute();
  }

  async getAllForInterface(interfaceId: string): Promise<SpeedLimitType[]> {
    const rows = await this.#db
      .select()
      .from(speedLimit)
      .innerJoin(client, eq(speedLimit.clientId, client.id))
      .where(eq(client.interfaceId, interfaceId));
    return rows.map((r) => r.speed_limit);
  }
}
