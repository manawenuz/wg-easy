import { sql, relations } from 'drizzle-orm';
import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { client, user } from '../../schema';

export const trafficGroup = sqliteTable('traffic_groups', {
  id: int().primaryKey({ autoIncrement: true }),
  name: text().notNull().unique(),
  colorLight: text('color_light').notNull(),
  colorDark: text('color_dark').notNull(),
  upKbps: int('up_kbps'),
  downKbps: int('down_kbps'),
  quotaLimitBytes: int('quota_limit_bytes', { mode: 'number' }),
  quotaPeriod: text('quota_period').$type<'daily' | 'weekly' | 'monthly'>(),
  quotaAutoDisable: int('quota_auto_disable', { mode: 'boolean' }).default(true),
  isDefault: int('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`)
    .$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
});

export const trafficGroupRelations = relations(trafficGroup, ({ many }) => ({
  clients: many(client),
  users: many(user),
}));
