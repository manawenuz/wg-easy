import { integer, sqliteTable } from 'drizzle-orm/sqlite-core';

import { client } from '../../schema';

export const speedLimit = sqliteTable('speed_limit', {
  clientId: integer('client_id')
    .primaryKey()
    .references(() => client.id, { onDelete: 'cascade' }),
  upKbps: integer('up_kbps').notNull().default(0),
  downKbps: integer('down_kbps').notNull().default(0),
  appliedAt: integer('applied_at', { mode: 'timestamp' }),
});
