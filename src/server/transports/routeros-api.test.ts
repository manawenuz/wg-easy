import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RouterOsApiTransport } from './routeros-api';

function createMockRouterOSClient() {
  const mockMenu = {
    where: vi.fn().mockReturnThis(),
    getAll: vi.fn().mockResolvedValue([{ name: 'test' }]),
    add: vi.fn().mockResolvedValue([{ '.id': '*1' }]),
    set: vi.fn().mockResolvedValue([]),
    remove: vi.fn().mockResolvedValue([]),
    exec: vi.fn().mockResolvedValue([]),
  };

  return {
    connect: vi.fn().mockResolvedValue({
      menu: vi.fn().mockReturnValue(mockMenu),
    }),
    isConnected: vi.fn().mockReturnValue(true),
    close: vi.fn().mockResolvedValue(undefined),
    _mockMenu: mockMenu,
  };
}

vi.mock('routeros-client', () => {
  return {
    RouterOSClient: vi.fn().mockImplementation(createMockRouterOSClient),
  };
});

describe('RouterOsApiTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('connects and prints rows', async () => {
    const transport = new RouterOsApiTransport({
      host: '192.168.1.1',
      user: 'admin',
      password: 'password',
    });

    const rows = await transport.print('/interface/wireguard/peers');
    expect(rows).toEqual([{ name: 'test' }]);
  });

  it('writes a new entry', async () => {
    const transport = new RouterOsApiTransport({
      host: '192.168.1.1',
      user: 'admin',
      password: 'password',
    });

    const result = await transport.write('/interface/wireguard/peers', {
      interface: 'wg1',
      'public-key': 'pk1',
    });

    expect(result).toEqual([{ '.id': '*1' }]);
  });

  it('closes connection', async () => {
    const transport = new RouterOsApiTransport({
      host: '192.168.1.1',
      user: 'admin',
      password: 'password',
    });

    await transport.connect();
    expect(transport.isConnected()).toBe(true);

    await transport.close();
    expect(transport.isConnected()).toBe(false);
  });
});
