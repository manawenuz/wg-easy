import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { router } from '../../schema';

export const exitNode = sqliteTable('exit_node', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  routerId: integer('router_id')
    .references(() => router.id)
    .notNull(),
  label: text('label').notNull(),
  enabled: integer('enabled', { mode: 'boolean' })
    .notNull()
    .default(true),
});
