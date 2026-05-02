import { describe, it, expect, beforeAll } from 'vitest';
import { configgen } from './configgen';

beforeAll(() => {
  (globalThis as any).WG_ENV = {
    PORT: '51821',
  };
});

describe('amneziawg configgen', () => {
  const mockInterface = {
    name: 'wg0',
    device: 'eth0',
    port: 51820,
    privateKey: 'serverPriv',
    publicKey: 'serverPub',
    ipv4Cidr: '10.8.0.0/24',
    ipv6Cidr: 'fd00::/64',
    mtu: 1420,
    jC: 7,
    jMin: 10,
    jMax: 1000,
    s1: 128,
    s2: 56,
    s3: null,
    s4: null,
    h1: '12345',
    h2: '12346',
    h3: '12347',
    h4: '12348',
    i1: null,
    i2: null,
    i3: null,
    i4: null,
    i5: null,
    enabled: true,
    firewallEnabled: false,
    engineType: 'amneziawg',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockClient = {
    id: 1,
    name: 'Test',
    userId: 1,
    interfaceId: 'wg0',
    ipv4Address: '10.8.0.2',
    ipv6Address: 'fd00::2',
    privateKey: 'clientPriv',
    publicKey: 'clientPub',
    preSharedKey: 'psk',
    preUp: '',
    postUp: '',
    preDown: '',
    postDown: '',
    allowedIps: ['0.0.0.0/0'],
    serverAllowedIps: [],
    firewallIps: null,
    persistentKeepalive: 25,
    mtu: 1420,
    jC: null,
    jMin: null,
    jMax: null,
    i1: null,
    i2: null,
    i3: null,
    i4: null,
    i5: null,
    dns: null,
    serverEndpoint: null,
    expiresAt: null,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockHooks = {
    id: 'wg0',
    preUp: '',
    postUp: '',
    preDown: '',
    postDown: '',
  };

  const mockUserConfig = {
    id: 'wg0',
    defaultDns: ['1.1.1.1'],
    defaultAllowedIps: ['0.0.0.0/0', '::/0'],
    defaultMtu: 1420,
    defaultPersistentKeepalive: 25,
    defaultJC: 7,
    defaultJMin: 10,
    defaultJMax: 1000,
    defaultI1: null,
    defaultI2: null,
    defaultI3: null,
    defaultI4: null,
    defaultI5: null,
    host: 'example.com',
    port: 51820,
  };

  it('generateServerInterface emits AWG parameters', () => {
    const config = configgen.generateServerInterface(
      mockInterface as any,
      mockHooks
    );
    expect(config).toContain('Jc = 7');
    expect(config).toContain('Jmin = 10');
    expect(config).toContain('Jmax = 1000');
    expect(config).toContain('S1 = 128');
    expect(config).toContain('S2 = 56');
    expect(config).toContain('H1 = 12345');
    expect(config).toContain('H2 = 12346');
    expect(config).toContain('H3 = 12347');
    expect(config).toContain('H4 = 12348');
  });

  it('generateServerInterface skips null AWG parameters', () => {
    const config = configgen.generateServerInterface(
      mockInterface as any,
      mockHooks
    );
    expect(config).not.toContain('S3 =');
    expect(config).not.toContain('S4 =');
    expect(config).not.toContain('I1 =');
  });

  it('generateClientConfig emits AWG parameters', () => {
    const config = configgen.generateClientConfig(
      mockInterface as any,
      mockUserConfig as any,
      mockClient as any
    );
    expect(config).toContain('S1 = 128');
    expect(config).toContain('S2 = 56');
    expect(config).toContain('H1 = 12345');
    expect(config).toContain('H2 = 12346');
    expect(config).toContain('H3 = 12347');
    expect(config).toContain('H4 = 12348');
  });

  it('generateClientConfig includes client-specific AWG params when set', () => {
    const clientWithParams = {
      ...mockClient,
      jC: 5,
      jMin: 15,
      jMax: 500,
      i1: '11111',
      i2: '22222',
    };
    const config = configgen.generateClientConfig(
      mockInterface as any,
      mockUserConfig as any,
      clientWithParams as any
    );
    expect(config).toContain('Jc = 5');
    expect(config).toContain('Jmin = 15');
    expect(config).toContain('Jmax = 500');
    expect(config).toContain('I1 = 11111');
    expect(config).toContain('I2 = 22222');
  });
});
