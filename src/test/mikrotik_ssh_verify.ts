import { RouterOsSshTransport } from '../server/transports/routeros-ssh';
import { SshTransport } from '../server/transports/ssh';
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';

function generatePublicKey(): string {
  return randomBytes(32).toString('base64');
}

async function main() {
  const config = {
    host: process.env.TEST_MIKROTIK_HOST || '172.16.81.127',
    port: parseInt(process.env.TEST_MIKROTIK_PORT || '22'),
    user: process.env.TEST_MIKROTIK_USER || 'admin',
    keyPath: process.env.TEST_MIKROTIK_KEY || '/root/.ssh/wzp'
  };

  console.log('Config:', { ...config, keyPath: config.keyPath });

  const ssh = new SshTransport({
    host: config.host,
    port: config.port,
    user: config.user,
    auth: {
      type: 'key',
      privateKey: readFileSync(config.keyPath, 'utf8')
    }
  });
  const transport = new RouterOsSshTransport(ssh);

  // Generate unique keys so we don't collide with previous test runs
  const TEST_PUBKEY_UNIQUE = generatePublicKey();

  try {
    console.log('Connecting to MikroTik via SSH...');
    const identity = await transport.print('/system/identity');
    console.log('System Identity:', identity);

    const resource = await transport.print('/system/resource');
    console.log('RouterOS Version:', resource[0]?.version);

    console.log('Testing print with query...');
    const interfaces = await transport.print('/interface/wireguard');
    console.log('WireGuard Interfaces:', interfaces.map(i => i.name));

    console.log('Testing peer creation...');
    await transport.write('/interface/wireguard/peers', {
        interface: 'wg0',
        'public-key': TEST_PUBKEY_UNIQUE,
        'allowed-address': '10.8.0.100/32',
        comment: 'wg-easy-test-peer'
    });
    console.log('Peer created.');

    console.log('Verifying peer exists...');
    const createdPeers = await transport.print('/interface/wireguard/peers', {
        'public-key': TEST_PUBKEY_UNIQUE
    });
    console.log('Found peers:', createdPeers.length);

    console.log('Testing speed limit...');
    const dummyPeer = {
        id: '999',
        name: 'test-peer',
        publicKey: TEST_PUBKEY_UNIQUE,
        ipv4Address: '10.8.0.254',
        enabled: true
    } as any;
    
    const { applySpeedLimit, clearSpeedLimit } = await import('../server/engines/mikrotik/speedlimit');
    
    console.log('Applying speed limit...');
    await applySpeedLimit(transport, dummyPeer, 1024, 2048);
    console.log('Speed limit applied.');

    console.log('Verifying mangle rules...');
    const mangles = await transport.print('/ip/firewall/mangle', { comment: 'wg-999-up' });
    console.log('Found mangles:', mangles.length);

    console.log('Verifying queue tree...');
    const queues = await transport.print('/queue/tree', { name: 'wg-999-up' });
    console.log('Found queues:', queues.length);

    console.log('Clearing speed limit...');
    await clearSpeedLimit(transport, dummyPeer);
    console.log('Speed limit cleared.');

    console.log('Cleaning up test peer...');
    const peersToClean = await transport.print('/interface/wireguard/peers', {
      'public-key': TEST_PUBKEY_UNIQUE
    });
    for (const p of peersToClean) {
      const id = String(p['.id'] ?? p.id ?? '');
      if (id) {
        await transport.remove('/interface/wireguard/peers', id);
      }
    }
    console.log('Test peer removed.');

    console.log('\n=== ALL TESTS PASSED ===');
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  } finally {
    await transport.close();
    console.log('Connection closed');
  }
}

main();
