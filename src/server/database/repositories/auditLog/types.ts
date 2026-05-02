import type { InferSelectModel } from 'drizzle-orm';
import type { auditLog } from './schema';

export type AuditLogType = InferSelectModel<typeof auditLog>;
