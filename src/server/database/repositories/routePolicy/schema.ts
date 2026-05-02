import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { wgInterface, client, exitNode } from '../../schema';

export const routePolicy = sqliteTable('route_policy', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  interfaceId: text('interface_id')
    .references(() => wgInterface.name, {
      onDelete: 'cascade',
      onUpdate: 'cascade',
    })
    .notNull(),
  clientId: integer('client_id').references(() => client.id, {
    onDelete: 'cascade',
  }),
  matchCidr: text('match_cidr').notNull(),
  exitNodeId: integer('exit_node_id')
    .references(() => exitNode.id)
    .notNull(),
  priority: integer('priority').notNull().default(100),
});
