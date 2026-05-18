import type { InferSelectModel } from 'drizzle-orm';
import type { userQuota } from './schema';

export type UserQuotaType = InferSelectModel<typeof userQuota>;
