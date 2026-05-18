import { describe, expect, test } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate as drizzleMigrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '../schema';

describe('p0 foundation migration', () => {
  test('applies cleanly to a fresh db and creates expected tables', async () => {
    const client = createClient({ url: ':memory:' });
    const db = drizzle({ client, schema });

    await drizzleMigrate(db, {
      migrationsFolder: './server/database/migrations',
    });

    const tables = (await db.all(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )) as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('router');
    expect(tableNames).toContain('user_quota');
    expect(tableNames).toContain('speed_limit');
    expect(tableNames).toContain('usage_sample');
    expect(tableNames).toContain('audit_log');
    expect(tableNames).toContain('admin_router_acl');
    expect(tableNames).toContain('exit_node');
    expect(tableNames).toContain('route_policy');
    expect(tableNames).toContain('api_token');
  });

  test('inserts the self-router row and backfills interfaces', async () => {
    const client = createClient({ url: ':memory:' });
    const db = drizzle({ client, schema });

    await drizzleMigrate(db, {
      migrationsFolder: './server/database/migrations',
    });

    // Verify self-router exists
    const selfRouter = await db.query.router.findFirst({
      where: (router, { eq }) => eq(router.id, 0),
    });

    expect(selfRouter).not.toBeNull();
    expect(selfRouter!.name).toBe('self');
    expect(selfRouter!.engineType).toBe('wireguard');
    expect(selfRouter!.transport).toBe('local-shell');
    expect(selfRouter!.enabled).toBe(true);

    // Verify backfill on the interface seeded by migration 0001
    const iface = await db.query.wgInterface.findFirst({
      where: (iface, { eq }) => eq(iface.name, 'wg0'),
    });

    expect(iface).not.toBeNull();
    expect(iface!.engineType).toBe('wireguard');
    expect(iface!.routerId).toBe(0);
  });
});
