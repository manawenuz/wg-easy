/**
 * One-shot: sync the live `manseTest` client (DB id=1) to tgCHR via MikrotikEngine.
 * Mirrors the API path POST /api/client → engine.syncInterface(iface, allClients).
 * Uses real DB row values; engine itself talks to the live router.
 */

import { readFileSync } from 'fs';
import { MikrotikEngine } from '../server/engines/mikrotik';
import { encrypt } from '../server/utils/crypto';
import type { InterfaceType } from '../server/database/repositories/interface/types';
import type { RouterType } from '../server/database/repositories/router/types';
import type { Client } from '../server/engines/types';

async function main() {
  const host = '172.16.81.127';
  const port = 22;
  const user = 'admin';
  const keyPath = '/root/.ssh/wzp';

  const sshKeyBase64 = Buffer.from(readFileSync(keyPath, 'utf8')).toString(
    'base64'
  );

  const router: RouterType = {
    id: 1,
    name: 'Test-MikroTik',
    engineType: 'mikrotik',
    transport: 'routeros-ssh',
    host,
    port,
    apiPort: 8729,
    tlsRequired: true,
    tlsFingerprintSha256: null,
    credentialsEncrypted: encrypt(
      JSON.stringify({
        apiUser: user,
        apiPassword: '',
        sshUser: user,
        sshKey: sshKeyBase64,
      })
    ),
    sshPassphraseEncrypted: null,
    enabled: true,
    lastSeen: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const iface: InterfaceType = {
    name: 'wg0',
    device: 'eth0',
    port: 51820,
    privateKey: 'server-priv',
    publicKey: 'server-pub',
    ipv4Cidr: '10.8.0.0/24',
    ipv6Cidr: 'fdcc:ad94:bacf:61a4::/64',
    mtu: 1420,
    enabled: true,
    firewallEnabled: false,
    engineType: 'mikrotik',
    routerId: 1,
    jC: 7,
    jMin: 10,
    jMax: 1000,
    s1: 128,
    s2: 56,
    s3: null,
    s4: null,
    h1: null,
    h2: null,
    h3: null,
    h4: null,
    i1: null,
    i2: null,
    i3: null,
    i4: null,
    i5: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const manseTest: Client = {
    id: 1,
    userId: 1,
    interfaceId: 'wg0',
    name: 'manseTest',
    publicKey: 'AcKLHsSL1sGzxHUhj8Sa5zQoQlbP+os4dGMXyxsAXms=',
    privateKey: 'wBByVAsLDTGn8zRHeB2imbedYUU0jfMpVa9O7AEZcmM=',
    preSharedKey: 'Zay8w77EOUPjUJHbhBar0CxFFomh3lkgPnKz5zcV2UM=',
    ipv4Address: '10.8.0.2',
    ipv6Address: 'fdcc:ad94:bacf:61a4::cafe:2',
    enabled: true,
    expiresAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    allowedIps: null,
    serverAllowedIps: [],
    firewallIps: null,
    persistentKeepalive: 0,
    mtu: 1420,
  };

  (globalThis as any).Database = {
    routers: {
      get: async (id: number) => (id === 1 ? router : undefined),
      updateLastSeen: async () => {},
    },
    clients: {
      findByPublicKey: async (pk: string) =>
        pk === manseTest.publicKey ? manseTest : undefined,
    },
  };
  (globalThis as any).WG_ENV = { DISABLE_IPV6: false };

  const engine = new MikrotikEngine();

  console.log('Health check...');
  const health = await engine.healthCheck(iface);
  console.log(' ', health);
  if (!health.ok) throw new Error('Health check failed');

  console.log('Calling syncInterface with manseTest...');
  await engine.syncInterface(iface, [manseTest]);
  console.log('  syncInterface completed.');

  console.log('Sampling usage to confirm peer present...');
  const samples = await engine.sampleUsage(iface);
  const present = samples.some((s) => s.publicKey === manseTest.publicKey);
  console.log('  peer present on router:', present);
  if (!present) throw new Error('manseTest NOT visible on router after sync');

  console.log('\n=== manseTest synced successfully ===');
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
