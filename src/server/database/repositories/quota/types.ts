import type { InferSelectModel } from 'drizzle-orm';
import type { quota } from './schema';

export type QuotaType = InferSelectModel<typeof quota>;
