import { and, asc, lte } from 'drizzle-orm';
import type { DBType } from '#db/sqlite';
import { pendingMutation } from './schema';
import type { MutationKind } from './types';

const MAX_ATTEMPTS = 10;
// Backoff steps in seconds: 15, 30, 60, 300, 900 (capped)
const BACKOFF_SECONDS = [15, 30, 60, 300, 900];

function nextBackoffMs(attempts: number): number {
  const idx = Math.min(attempts, BACKOFF_SECONDS.length - 1);
  return BACKOFF_SECONDS[idx]! * 1000;
}

export class PendingMutationService {
  #db: DBType;

  constructor(db: DBType) {
    this.#db = db;
  }

  async enqueue(
    interfaceId: string,
    kind: MutationKind,
    payload: object,
    clientId?: number
  ) {
    const now = new Date();
    await this.#db.insert(pendingMutation).values({
      interfaceId,
      kind,
      clientId: clientId ?? null,
      payload,
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
    });
  }

  async getDue(now: Date) {
    return this.#db.query.pendingMutation.findMany({
      where: and(lte(pendingMutation.nextAttemptAt, now)),
      orderBy: asc(pendingMutation.createdAt),
    });
  }

  async markSuccess(id: number) {
    const { eq } = await import('drizzle-orm');
    await this.#db.delete(pendingMutation).where(eq(pendingMutation.id, id));
  }

  async markFailure(id: number, attempts: number, error: string) {
    const { eq } = await import('drizzle-orm');
    const nextAttemptAt = new Date(Date.now() + nextBackoffMs(attempts));
    await this.#db
      .update(pendingMutation)
      .set({ attempts, lastError: error, nextAttemptAt })
      .where(eq(pendingMutation.id, id));
  }

  async delete(id: number) {
    const { eq } = await import('drizzle-orm');
    await this.#db.delete(pendingMutation).where(eq(pendingMutation.id, id));
  }

  get maxAttempts() {
    return MAX_ATTEMPTS;
  }
}
