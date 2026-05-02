import type { InferSelectModel } from 'drizzle-orm';
import type { speedLimit } from './schema';

export type SpeedLimitType = InferSelectModel<typeof speedLimit>;
