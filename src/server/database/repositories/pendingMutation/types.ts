import type { InferSelectModel } from 'drizzle-orm';
import { pendingMutation } from './schema';

export type PendingMutationType = InferSelectModel<typeof pendingMutation>;

export type MutationKind = 'syncInterface';
