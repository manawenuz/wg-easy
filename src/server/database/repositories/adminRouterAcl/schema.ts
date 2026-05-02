import { primaryKey, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { user, router } from '../../schema';

export const adminRouterAcl = sqliteTable(
  'admin_router_acl',
  {
    userId: integer('user_id')
      .references(() => user.id, { onDelete: 'cascade' })
      .notNull(),
    routerId: integer('router_id')
      .references(() => router.id, { onDelete: 'cascade' })
      .notNull(),
    permission: text('permission')
      .$type<'read' | 'write' | 'admin'>()
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.routerId] }),
  })
);
