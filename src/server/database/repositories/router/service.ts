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

  async recordHealth(id: ID, success: boolean, error?: string): Promise<{ crossedThreshold: boolean; recovered: boolean }> {
    const current = await this.get(id);
    const prev = current?.consecutiveFailures ?? 0;

    if (success) {
      await this.#db.update(router).set({
        lastSeenOkAt: new Date(),
        lastSeenError: null,
        consecutiveFailures: 0,
      }).where(eq(router.id, id));
      return { crossedThreshold: false, recovered: prev >= 3 };
    } else {
      const next = prev + 1;
      await this.#db.update(router).set({
        lastSeenError: error ?? 'unknown error',
        consecutiveFailures: next,
      }).where(eq(router.id, id));
      return { crossedThreshold: next === 3, recovered: false };
    }
  }
}
