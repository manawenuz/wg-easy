import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { EngineType } from '../../../engines/types';

export type TransportType = 'local-shell' | 'ssh' | 'routeros-api' | 'routeros-ssh';

export const router = sqliteTable('router', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  engineType: text('engine_type').$type<EngineType>().notNull(),
  transport: text('transport').$type<TransportType>().notNull(),
  host: text('host'),
  port: integer('port'),
  credentialsEncrypted: text('credentials_encrypted'),
  sshPassphraseEncrypted: text('ssh_passphrase_encrypted'),
  tlsFingerprintSha256: text('tls_fingerprint_sha256'),
  apiPort: integer('api_port').notNull().default(8729),
  tlsRequired: integer('tls_required', { mode: 'boolean' }).notNull().default(true),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastSeen: integer('last_seen', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`)
    .$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
});
