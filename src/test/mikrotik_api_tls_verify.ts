import { RouterOsApiTransport } from '../server/transports/routeros-api';
import { TlsPinError } from '../server/transports/tls-pin';

// This test requires a live MikroTik router or tgCHR.
// Run with: npx tsx test/mikrotik_api_tls_verify.ts

const HOST = process.env.MT_HOST || '172.16.81.127';
const USER = process.env.MT_USER || 'admin';
const PASS = process.env.MT_PASS || 'password';
const PIN = process.env.MT_PIN; // Expected SHA-256 SPKI fingerprint

async function main() {
  console.log(`Connecting to ${HOST}...`);

  const transport = new RouterOsApiTransport({
    host: HOST,
    user: USER,
    password: PASS,
    tls: true,
    tlsFingerprint: PIN,
  });

  try {
    console.log('Testing connectivity...');
    const identity = await transport.print('/system/identity');
    console.log('Success! Router identity:', identity[0]?.name);

    const resource = await transport.print('/system/resource');
    console.log('Version:', resource[0]?.version);

    if (PIN) {
      console.log('Testing deliberate pin mismatch...');
      const wrongTransport = new RouterOsApiTransport({
        host: HOST,
        user: USER,
        password: PASS,
        tls: true,
        tlsFingerprint: '00'.repeat(32),
      });

      try {
        await wrongTransport.connect();
        console.error('FAILED: Connection succeeded despite wrong fingerprint!');
        process.exit(1);
      } catch (err) {
        if (err instanceof TlsPinError) {
          console.log('Success: Connection rejected with TlsPinError as expected.');
        } else {
          console.error('FAILED: Connection rejected but with wrong error type:', err);
          process.exit(1);
        }
      }
    }

    console.log('Integration test PASSED');
  } catch (err) {
    console.error('Integration test FAILED:', err);
    process.exit(1);
  } finally {
    await transport.close();
  }
}

main();
