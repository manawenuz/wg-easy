import { eq } from 'drizzle-orm';
import { router } from './schema';
import type { RouterType } from './types';
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

  async create(data: Omit<RouterType, 'id' | 'createdAt' | 'updatedAt'>): Promise<RouterType> {
    const result = await this.#db.insert(router).values(data).returning();
    return result[0]!;
  }

  async update(id: ID, data: Partial<Omit<RouterType, 'id' | 'createdAt' | 'updatedAt'>>): Promise<RouterType | undefined> {
    const result = await this.#db
      .update(router)
      .set(data)
      .where(eq(router.id, id))
      .returning();
    return result[0];
  }

  async delete(id: ID): Promise<void> {
    await this.#db.delete(router).where(eq(router.id, id));
  }

  async updateLastSeen(id: ID, lastSeen: Date): Promise<void> {
    await this.#db
      .update(router)
      .set({ lastSeen })
      .where(eq(router.id, id));
  }
}
