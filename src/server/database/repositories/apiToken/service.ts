import { eq, sql } from 'drizzle-orm';
import { apiToken } from './schema';
import type { DBType } from '#db/sqlite';
import type { ApiTokenType } from './types';

export class ApiTokenService {
  #db: DBType;

  constructor(db: DBType) {
    this.#db = db;
  }

  async getAll() {
    return this.#db.query.apiToken.findMany();
  }

  async getByUserId(userId: ID) {
    return this.#db.query.apiToken.findMany({
      where: eq(apiToken.userId, userId),
    });
  }

  async create({
    userId,
    tokenHash,
    label,
    scopes,
    expiresAt,
  }: {
    userId: ID;
    tokenHash: string;
    label?: string;
    scopes?: string;
    expiresAt?: Date;
  }) {
    const result = await this.#db
      .insert(apiToken)
      .values({
        userId,
        tokenHash,
        label,
        scopes,
        expiresAt,
      })
      .returning({ id: apiToken.id })
      .execute();

    return result[0];
  }

  async delete(id: ID) {
    return this.#db
      .delete(apiToken)
      .where(eq(apiToken.id, id))
      .execute();
  }

  async findById(id: ID): Promise<ApiTokenType | undefined> {
    return this.#db.query.apiToken.findFirst({
      where: eq(apiToken.id, id),
    });
  }

  async findValidTokens(): Promise<ApiTokenType[]> {
    const now = new Date();
    return this.#db.query.apiToken.findMany({
      where: sql`${apiToken.expiresAt} IS NULL OR ${apiToken.expiresAt} > ${now}`,
    });
  }

  async updateLastUsed(id: ID) {
    return this.#db
      .update(apiToken)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiToken.id, id))
      .execute();
  }
}
