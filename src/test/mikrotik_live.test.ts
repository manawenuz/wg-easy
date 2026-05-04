import { RouterOsApiTransport } from '../server/transports/routeros-api';
import { describe, it, expect } from 'vitest';

// These credentials match the ones retrieved from node_modules/.env and user input
const config = {
  host: process.env.TEST_MIKROTIK_HOST || '172.16.81.127',
  port: parseInt(process.env.TEST_MIKROTIK_PORT || '8728'),
  user: process.env.TEST_MIKROTIK_USER || 'wg-easy',
  password: process.env.TEST_MIKROTIK_PASSWORD
};

describe('MikroTik Live Integration', () => {
  it('should connect and retrieve system identity', async () => {
    const transport = new RouterOsApiTransport(config.host, config.port, config.user, config.password);
    
    try {
      await transport.connect();
      console.log('Connected to MikroTik successfully');
      
      const identity = await transport.print('/system/identity');
      console.log('System Identity:', identity);
      
      expect(identity).toBeDefined();
      expect(identity.length).toBeGreaterThan(0);
      
      const resource = await transport.print('/system/resource');
      console.log('RouterOS Version:', resource[0]?.version);
      
      expect(resource[0]?.version).toBeDefined();
      
    } finally {
      await transport.close();
      console.log('Connection closed');
    }
  }, 10000); // 10s timeout for live network
});
