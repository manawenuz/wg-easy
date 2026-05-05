import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RouterOsApiTransport } from './routeros-api';

const mockSend = vi.fn();
const mockLogin = vi.fn().mockResolvedValue(undefined);
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockClose = vi.fn().mockResolvedValue(undefined);

vi.mock('./routeros-api-protocol', () => ({
  RouterOsApiProtocol: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    login: mockLogin,
    send: mockSend,
    close: mockClose,
  })),
}));

vi.mock('./tls-pin', () => ({
  checkServerIdentity: vi.fn().mockReturnValue(undefined),
}));

describe('RouterOsApiTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockLogin.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);
  });

  it('connects and prints rows', async () => {
    mockSend.mockResolvedValueOnce([
      { type: '!re', attributes: { name: 'test' } },
      { type: '!done', attributes: {} },
    ]);

    const transport = new RouterOsApiTransport({
      host: '192.168.1.1',
      user: 'admin',
      password: 'password',
    });

    const rows = await transport.print('/interface/wireguard/peers');
    expect(rows).toEqual([{ name: 'test' }]);
    expect(mockSend).toHaveBeenCalledWith(['/interface/wireguard/peers/print']);
  });

  it('writes a new entry', async () => {
    mockSend.mockResolvedValueOnce([
      { type: '!re', attributes: { '.id': '*1' } },
      { type: '!done', attributes: {} },
    ]);

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
    mockSend.mockResolvedValue([{ type: '!done', attributes: {} }]);

    const transport = new RouterOsApiTransport({
      host: '192.168.1.1',
      user: 'admin',
      password: 'password',
    });

    await transport.connect();
    expect(transport.isConnected()).toBe(true);

    await transport.close();
    expect(transport.isConnected()).toBe(false);
    expect(mockClose).toHaveBeenCalled();
  });
});
