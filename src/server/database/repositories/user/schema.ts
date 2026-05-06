import { sql, relations } from 'drizzle-orm';
import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { client, trafficGroup } from '../../schema';

export const user = sqliteTable('users_table', {
  id: int().primaryKey({ autoIncrement: true }),
  username: text().notNull().unique(),
  password: text().notNull(),
  email: text(),
  name: text().notNull(),
  role: int().$type<Role>().notNull(),
  totpKey: text('totp_key'),
  totpVerified: int('totp_verified', { mode: 'boolean' }).notNull(),
  enabled: int({ mode: 'boolean' }).notNull(),
  defaultTrafficGroupId: int('default_traffic_group_id').references(() => trafficGroup.id, {
    onDelete: 'set null',
  }),
  parentUserId: int('parent_user_id').references(() => user.id, {
    onDelete: 'cascade',
  }),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`)
    .$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
});

export const usersRelations = relations(user, ({ many, one }) => ({
  clients: many(client),
  defaultTrafficGroup: one(trafficGroup, {
    fields: [user.defaultTrafficGroupId],
    references: [trafficGroup.id],
  }),
  parent: one(user, {
    fields: [user.parentUserId],
    references: [user.id],
    relationName: 'subaccounts',
  }),
  subaccounts: many(user, {
    relationName: 'subaccounts',
  }),
}));
