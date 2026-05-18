import { describe, expect, test } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import * as schema from '../schema';

describe('migration 0016_per_user_quota', () => {
  test('merges per-client quotas into per-user quota', async () => {
    const client = createClient({ url: ':memory:' });
    const db = drizzle({ client, schema });

    // Build pre-migration schema manually so we can seed the old quota table
    await client.execute(`
      CREATE TABLE users_table (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        email TEXT,
        name TEXT NOT NULL,
        role INTEGER NOT NULL,
        totp_key TEXT,
        totp_verified INTEGER NOT NULL,
        enabled INTEGER NOT NULL,
        default_traffic_group_id INTEGER,
        parent_user_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      )
    `);

    await client.execute(`
      CREATE TABLE interfaces_table (
        name TEXT PRIMARY KEY,
        device TEXT NOT NULL,
        port INTEGER NOT NULL UNIQUE,
        private_key TEXT NOT NULL,
        public_key TEXT NOT NULL,
        ipv4_cidr TEXT NOT NULL,
        ipv6_cidr TEXT NOT NULL,
        mtu INTEGER NOT NULL,
        enabled INTEGER NOT NULL,
        firewall_enabled INTEGER NOT NULL DEFAULT 0,
        engine_type TEXT NOT NULL DEFAULT 'wireguard',
        router_id INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      )
    `);

    await client.execute(`
      CREATE TABLE clients_table (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        interface_id TEXT NOT NULL,
        name TEXT NOT NULL,
        ipv4_address TEXT NOT NULL UNIQUE,
        ipv6_address TEXT NOT NULL UNIQUE,
        private_key TEXT NOT NULL,
        public_key TEXT NOT NULL,
        pre_shared_key TEXT NOT NULL,
        persistent_keepalive INTEGER NOT NULL,
        mtu INTEGER NOT NULL,
        server_allowed_ips TEXT NOT NULL,
        enabled INTEGER NOT NULL
      )
    `);

    await client.execute(`
      CREATE TABLE quota (
        client_id INTEGER PRIMARY KEY REFERENCES clients_table(id) ON DELETE CASCADE,
        limit_bytes INTEGER NOT NULL,
        period TEXT NOT NULL,
        used_bytes INTEGER NOT NULL DEFAULT 0,
        period_start INTEGER NOT NULL,
        period_end INTEGER NOT NULL,
        auto_disable INTEGER NOT NULL DEFAULT 1,
        disabled_by_quota_at INTEGER
      )
    `);

    // Seed data
    await client.execute(`
      INSERT INTO users_table (id, username, password, name, role, totp_verified, enabled)
      VALUES
        (1, 'alice', 'x', 'Alice', 2, 0, 1),
        (2, 'bob', 'x', 'Bob', 2, 0, 1)
    `);

    await client.execute(`
      INSERT INTO interfaces_table (name, device, port, private_key, public_key, ipv4_cidr, ipv6_cidr, mtu, enabled, engine_type, router_id)
      VALUES ('wg0', 'eth0', 51820, 'sk', 'pk', '10.8.0.0/24', 'fd00::/64', 1420, 1, 'wireguard', 0)
    `);

    await client.execute(`
      INSERT INTO clients_table (id, user_id, interface_id, name, ipv4_address, ipv6_address, private_key, public_key, pre_shared_key, persistent_keepalive, mtu, server_allowed_ips, enabled)
      VALUES
        (10, 1, 'wg0', 'alice-phone', '10.8.0.2', 'fd00::2', 'sk', 'pk1', 'psk', 0, 1420, '[]', 1),
        (11, 1, 'wg0', 'alice-laptop', '10.8.0.3', 'fd00::3', 'sk', 'pk2', 'psk', 0, 1420, '[]', 1),
        (12, 2, 'wg0', 'bob-phone', '10.8.0.4', 'fd00::4', 'sk', 'pk3', 'psk', 0, 1420, '[]', 1)
    `);

    await client.execute(`
      INSERT INTO quota (client_id, limit_bytes, period, used_bytes, period_start, period_end, auto_disable)
      VALUES
        (10, 1073741824, 'monthly', 100, 1704067200000, 1706745600000, 1),
        (11, 1073741824, 'monthly', 200, 1704067200000, 1706745600000, 1),
        (12, 536870912, 'daily', 50, 1704067200000, 1704153600000, 0)
    `);

    // Run the migration SQL
    await client.execute(`
      CREATE TABLE user_quota (
        user_id INTEGER PRIMARY KEY REFERENCES users_table(id) ON DELETE CASCADE,
        limit_bytes INTEGER NOT NULL,
        period TEXT NOT NULL CHECK (period IN ('daily','weekly','monthly')),
        used_bytes INTEGER NOT NULL DEFAULT 0,
        period_start INTEGER NOT NULL,
        period_end INTEGER NOT NULL,
        auto_disable INTEGER NOT NULL DEFAULT 1,
        disabled_by_quota_at INTEGER
      )
    `);

    await client.execute(`
      INSERT INTO user_quota (user_id, limit_bytes, period, used_bytes, period_start, period_end, auto_disable, disabled_by_quota_at)
      SELECT
        c.user_id,
        MAX(q.limit_bytes) AS limit_bytes,
        MIN(q.period) AS period,
        SUM(q.used_bytes) AS used_bytes,
        MIN(q.period_start) AS period_start,
        MIN(q.period_end) AS period_end,
        MAX(q.auto_disable) AS auto_disable,
        MIN(q.disabled_by_quota_at) AS disabled_by_quota_at
      FROM quota q
      JOIN clients_table c ON c.id = q.client_id
      WHERE c.user_id IS NOT NULL
      GROUP BY c.user_id
    `);

    await client.execute(`DROP TABLE quota`);

    // Verify merged rows using Drizzle on the new schema
    const aliceQuota = await db.select().from(schema.userQuota).where(eq(schema.userQuota.userId, 1));
    expect(aliceQuota).toHaveLength(1);
    expect(aliceQuota[0]!.limitBytes).toBe(1073741824);
    expect(aliceQuota[0]!.usedBytes).toBe(300); // 100 + 200
    expect(aliceQuota[0]!.period).toBe('monthly');
    expect(aliceQuota[0]!.autoDisable).toBe(true);

    const bobQuota = await db.select().from(schema.userQuota).where(eq(schema.userQuota.userId, 2));
    expect(bobQuota).toHaveLength(1);
    expect(bobQuota[0]!.limitBytes).toBe(536870912);
    expect(bobQuota[0]!.usedBytes).toBe(50);
    expect(bobQuota[0]!.period).toBe('daily');
    expect(bobQuota[0]!.autoDisable).toBe(false);
  });
});
