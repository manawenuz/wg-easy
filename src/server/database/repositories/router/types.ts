import type { InferSelectModel } from 'drizzle-orm';
import type { router } from './schema';

export type RouterType = InferSelectModel<typeof router>;
