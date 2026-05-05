import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { client } from '../../schema';

export const pendingMutation = sqliteTable(
  'pending_mutation',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    interfaceId: text('interface_id').notNull(),
    kind: text('kind').$type<'syncInterface'>().notNull(),
    clientId: integer('client_id').references(() => client.id, {
      onDelete: 'cascade',
    }),
    payload: text('payload', { mode: 'json' }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp' }).notNull(),
    lastError: text('last_error'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [index('idx_pending_mutation_iface_next').on(t.interfaceId, t.nextAttemptAt)]
);
