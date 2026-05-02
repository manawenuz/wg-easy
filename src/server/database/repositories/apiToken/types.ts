import type { InferSelectModel } from 'drizzle-orm';
import type { apiToken } from './schema';

export type ApiTokenType = InferSelectModel<typeof apiToken>;
