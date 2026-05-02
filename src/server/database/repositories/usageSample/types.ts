import type { InferSelectModel } from 'drizzle-orm';
import type { usageSample } from './schema';

export type UsageSampleType = InferSelectModel<typeof usageSample>;
