import { index, integer, sqliteTable } from 'drizzle-orm/sqlite-core';

import { client } from '../../schema';

export const usageSample = sqliteTable(
  'usage_sample',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    clientId: integer('client_id')
      .references(() => client.id, { onDelete: 'cascade' })
      .notNull(),
    rxBytes: integer('rx_bytes').notNull(),
    txBytes: integer('tx_bytes').notNull(),
    ts: integer('ts', { mode: 'timestamp' }).notNull(),
  },
  (t) => ({
    clientTs: index('usage_sample_client_ts').on(t.clientId, t.ts),
  })
);
