import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { user } from '../../schema';

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  actorUserId: integer('actor_user_id').references(() => user.id),
  action: text('action').notNull(),
  target: text('target'),
  result: text('result').$type<'ok' | 'error'>().notNull(),
  ts: integer('ts', { mode: 'timestamp' })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});
