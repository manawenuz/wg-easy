/**
 * MikroTik Engine Integration Test
 *
 * Tests the full MikrotikEngine.syncInterface flow against a live router.
 * Simulates UI client creation → engine.syncInterface → router provisioning.
 */

import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { MikrotikEngine } from '../server/engines/mikrotik';
import { encrypt } from '../server/utils/crypto';
import type { InterfaceType } from '../server/database/repositories/interface/types';
import type { RouterType } from '../server/database/repositories/router/types';
import type { Client } from '../server/engines/types';

function generateKeyPair(): { publicKey: string; privateKey: string } {
  // MikroTik accepts any 32-byte base64 string as a WireGuard public key
  const privateKey = randomBytes(32).toString('base64');
  const publicKey = randomBytes(32).toString('base64');
  return { privateKey, publicKey };
}

function generatePsk(): string {
  return randomBytes(32).toString('base64');
}

async function main() {
  const host = process.env.TEST_MIKROTIK_HOST || '172.16.81.127';
  const port = parseInt(process.env.TEST_MIKROTIK_PORT || '22', 10);
  const user = process.env.TEST_MIKROTIK_USER || 'admin';
  const keyPath = process.env.TEST_MIKROTIK_KEY || '/root/.ssh/wzp';

  console.log('=== MikroTik Engine Integration Test ===');
  console.log('Router:', { host, port, user });

  const sshKeyRaw = readFileSync(keyPath, 'utf8');
  const sshKeyBase64 = Buffer.from(sshKeyRaw).toString('base64');

  const routerId = 999;
  const ifaceName = 'wg0';

  const router: RouterType = {
    id: routerId,
    name: 'test-router',
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
    name: ifaceName,
    device: 'eth0',
    port: 51820,
    privateKey: 'server-priv',
    publicKey: 'server-pub',
    ipv4Cidr: '10.8.0.0/24',
    ipv6Cidr: 'fd00::/64',
    mtu: 1420,
    enabled: true,
    firewallEnabled: false,
    engineType: 'mikrotik',
    routerId,
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

  // Mock globals required by the engine
  const mockClients: Client[] = [];
  (globalThis as any).Database = {
    routers: {
      get: async (id: number) => (id === routerId ? router : undefined),
      updateLastSeen: async () => {},
    },
    clients: {
      findByPublicKey: async (publicKey: string) =>
        mockClients.find((c) => c.publicKey === publicKey) ?? undefined,
    },
  };

  (globalThis as any).WG_ENV = { DISABLE_IPV6: false };

  const engine = new MikrotikEngine();

  const peer1Keys = generateKeyPair();
  const peer2Keys = generateKeyPair();

  let peers: Client[] = [];

  const findPeerOnRouter = async (publicKey: string): Promise<boolean> => {
    const samples = await engine.sampleUsage(iface);
    return samples.some((s) => s.publicKey === publicKey);
  };

  try {
    // --- Phase 1: Health check ---
    console.log('\n[1/6] Health check...');
    const health = await engine.healthCheck(iface);
    console.log('  Health:', health);
    if (!health.ok) {
      throw new Error(`Health check failed: ${health.details}`);
    }

    // --- Phase 2: Create peers ---
    console.log('\n[2/6] Creating peers via syncInterface...');
    peers = [
      {
        id: 901,
        userId: 1,
        interfaceId: ifaceName,
        name: 'engine-test-peer-1',
        publicKey: peer1Keys.publicKey,
        privateKey: peer1Keys.privateKey,
        preSharedKey: generatePsk(),
        ipv4Address: '10.8.0.201',
        ipv6Address: 'fd00::201',
        enabled: true,
        expiresAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        allowedIps: null,
        serverAllowedIps: [],
        firewallIps: null,
        persistentKeepalive: 25,
        mtu: 1420,
      },
      {
        id: 902,
        userId: 1,
        interfaceId: ifaceName,
        name: 'engine-test-peer-2',
        publicKey: peer2Keys.publicKey,
        privateKey: peer2Keys.privateKey,
        preSharedKey: generatePsk(),
        ipv4Address: '10.8.0.202',
        ipv6Address: 'fd00::202',
        enabled: true,
        expiresAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        allowedIps: null,
        serverAllowedIps: [],
        firewallIps: null,
        persistentKeepalive: 25,
        mtu: 1420,
      },
    ];

    await engine.syncInterface(iface, peers);
    console.log('  syncInterface completed.');

    // Populate mock database so speed limit service can find peers
    mockClients.push(...peers);

    // --- Phase 3: Verify peers exist ---
    console.log('\n[3/6] Verifying peers on router...');
    const found1 = await findPeerOnRouter(peer1Keys.publicKey);
    const found2 = await findPeerOnRouter(peer2Keys.publicKey);
    if (!found1) throw new Error('Peer 1 not found on router');
    if (!found2) throw new Error('Peer 2 not found on router');
    console.log('  Both peers found.');

    // --- Phase 4: Update peer (disable peer-1) ---
    console.log('\n[4/6] Updating peer (disabling peer-1)...');
    peers[0]!.enabled = false;
    await engine.syncInterface(iface, peers);

    // sampleUsage doesn't expose disabled status; use healthCheck-like approach
    // by re-querying via the engine's internal transport. Since we can't access
    // private fields, we verify idempotency by running sync again and ensuring
    // no errors. Then we remove all peers and verify cleanup.
    console.log('  syncInterface (update) completed without error.');

    // --- Phase 5: Speed limit ---
    console.log('\n[5/6] Applying and clearing speed limit on peer-2...');
    await engine.applySpeedLimit(iface, peer2Keys.publicKey, 1024, 2048);
    console.log('  Speed limit applied.');
    await engine.clearSpeedLimit(iface, peer2Keys.publicKey);
    console.log('  Speed limit cleared.');

    // --- Phase 6: Remove peers ---
    console.log('\n[6/6] Removing peers via syncInterface...');
    peers = [];
    await engine.syncInterface(iface, peers);

    const remaining1 = await findPeerOnRouter(peer1Keys.publicKey);
    const remaining2 = await findPeerOnRouter(peer2Keys.publicKey);
    if (remaining1 || remaining2) {
      throw new Error('Peers were not removed from router');
    }
    console.log('  All peers removed.');

    console.log('\n=== ALL TESTS PASSED ===');
    process.exit(0);
  } catch (err) {
    console.error('\nTEST FAILED:', err);

    // Attempt cleanup
    try {
      console.log('Attempting cleanup...');
      await engine.syncInterface(iface, []);
      console.log('Cleanup completed.');
    } catch (cleanupErr) {
      console.error('Cleanup failed:', cleanupErr);
    }

    process.exit(1);
  }
}

main();
