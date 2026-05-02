import type { InferSelectModel } from 'drizzle-orm';
import type { routePolicy } from './schema';

export type RoutePolicyType = InferSelectModel<typeof routePolicy>;
