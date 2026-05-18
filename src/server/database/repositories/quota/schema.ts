import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { user } from '../../schema';

export const userQuota = sqliteTable('user_quota', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  limitBytes: integer('limit_bytes', { mode: 'number' }).notNull(),
  period: text('period')
    .$type<'daily' | 'weekly' | 'monthly'>()
    .notNull(),
  usedBytes: integer('used_bytes').notNull().default(0),
  periodStart: integer('period_start', { mode: 'timestamp' }).notNull(),
  periodEnd: integer('period_end', { mode: 'timestamp' }).notNull(),
  autoDisable: integer('auto_disable', { mode: 'boolean' })
    .notNull()
    .default(true),
  disabledByQuotaAt: integer('disabled_by_quota_at', {
    mode: 'timestamp',
  }),
});
