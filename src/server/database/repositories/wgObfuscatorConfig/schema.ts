import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { wgInterface } from '../interface/schema';

export const wgObfuscatorConfig = sqliteTable('wg_obfuscator_config', {
  interfaceId: text('interface_id')
    .primaryKey()
    .references(() => wgInterface.name, { onDelete: 'cascade', onUpdate: 'cascade' }),
  listenPort: integer('listen_port').notNull(),
  wgTargetPort: integer('wg_target_port').notNull(),
  key: text('key').notNull(),
  dummyPaddingMin: integer('dummy_padding_min').notNull().default(8),
  dummyPaddingMax: integer('dummy_padding_max').notNull().default(64),
});
