import type { InferSelectModel } from 'drizzle-orm';
import type { adminRouterAcl } from './schema';

export type AdminRouterAclType = InferSelectModel<typeof adminRouterAcl>;
