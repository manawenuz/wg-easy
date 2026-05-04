const { RouterOSClient } = require('routeros-client');

async function test() {
  const client = new RouterOSClient({
    host: process.env.TEST_MIKROTIK_HOST || '172.16.81.127',
    port: parseInt(process.env.TEST_MIKROTIK_PORT || '8728'),
    user: process.env.TEST_MIKROTIK_USER || 'wg-easy',
    password: process.env.TEST_MIKROTIK_PASSWORD,
  });

  try {
    console.log('Connecting to MikroTik...');
    const api = await client.connect();
    console.log('Connected!');

    const identity = await api.menu('/system/identity').getAll();
    console.log('System Identity:', identity);

    const resource = await api.menu('/system/resource').getAll();
    console.log('RouterOS Version:', resource[0]?.version);
    console.log('Model:', resource[0]?.board_name || resource[0]?.['board-name']);

    const interfaces = await api.menu('/interface/wireguard').getAll();
    console.log('WireGuard Interfaces:', interfaces.length);

    await client.close();
    console.log('Done.');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

test();
