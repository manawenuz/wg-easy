import type { InferSelectModel } from 'drizzle-orm';
import type { exitNode } from './schema';

export type ExitNodeType = InferSelectModel<typeof exitNode>;
