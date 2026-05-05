import { RouterOsSshTransport } from '../server/transports/routeros-ssh';
import { SshTransport } from '../server/transports/ssh';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// These credentials match the ones retrieved from node_modules/.env and user input
const config = {
  host: process.env.TEST_MIKROTIK_HOST || '172.16.81.127',
  port: parseInt(process.env.TEST_MIKROTIK_PORT || '22'),
  user: process.env.TEST_MIKROTIK_USER || 'admin',
  keyPath: process.env.TEST_MIKROTIK_KEY || join(process.env.HOME || '', '.ssh/wzp')
};

describe('MikroTik Live Integration (SSH)', () => {
  it('should connect and retrieve system identity', async () => {
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
    
    try {
      console.log('Connecting to MikroTik via SSH...');
      const identity = await transport.print('/system/identity');
      console.log('System Identity:', identity);
      
      expect(identity).toBeDefined();
      expect(identity.length).toBeGreaterThan(0);
      expect(identity[0].name).toBeDefined();
      
      const resource = await transport.print('/system/resource');
      console.log('RouterOS Version:', resource[0]?.version);
      
      expect(resource[0]?.version).toBeDefined();
      
    } finally {
      await transport.close();
      console.log('Connection closed');
    }
  }, 30000); // 30s timeout for live network
});
