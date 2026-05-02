import { describe, it, expect, vi } from 'vitest';
import type { RouterOsApiTransport } from '../../transports/routeros-api';
import type { Client } from '../types';
import { applySpeedLimit, clearSpeedLimit } from './speedlimit';

function makeTransport() {
  const writes: Array<{ path: string; params: Record<string, unknown> }> = [];
  const prints: Array<{ path: string; query?: Record<string, unknown> }> = [];
  const removes: Array<{ path: string; id: string }> = [];

  const transport = {
    write: vi.fn(async (path: string, params: Record<string, unknown>) => {
      writes.push({ path, params });
      return [];
    }),
    print: vi.fn(async (path: string, query?: Record<string, unknown>) => {
      prints.push({ path, query });
      return [];
    }),
    remove: vi.fn(async (path: string, id: string) => {
      removes.push({ path, id });
      return [];
    }),
    set: vi.fn(async () => []),
  } as unknown as RouterOsApiTransport;

  return { transport, writes, prints, removes };
}

function makePeer(overrides: Partial<Client> = {}): Client {
  return {
    id: 42,
    userId: 1,
    interfaceId: 'wg1',
    name: 'bob',
    publicKey: 'pk',
    privateKey: 'priv',
    preSharedKey: 'psk',
    ipv4Address: '10.8.0.5',
    ipv6Address: 'fd00::5',
    enabled: true,
    expiresAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    allowedIps: null,
    serverAllowedIps: [],
    firewallIps: null,
    persistentKeepalive: 25,
    mtu: 1420,
    ...overrides,
  };
}

describe('applySpeedLimit', () => {
  it('creates mangle and queue entries', async () => {
    const { transport, writes } = makeTransport();
    const peer = makePeer();

    await applySpeedLimit(transport, peer, 1000, 2000);

    // Should clear first, then add 4 entries (2 mangle + 2 queue)
    expect(writes).toHaveLength(4);

    const mangleUp = writes.find((w) => w.path === '/ip/firewall/mangle' && w.params.comment === 'wg-42-up');
    const mangleDown = writes.find((w) => w.path === '/ip/firewall/mangle' && w.params.comment === 'wg-42-down');
    const queueUp = writes.find((w) => w.path === '/queue/tree' && w.params.name === 'wg-42-up');
    const queueDown = writes.find((w) => w.path === '/queue/tree' && w.params.name === 'wg-42-down');

    expect(mangleUp).toBeDefined();
    expect(mangleUp!.params['src-address']).toBe('10.8.0.5/32');
    expect(mangleDown).toBeDefined();
    expect(mangleDown!.params['dst-address']).toBe('10.8.0.5/32');
    expect(queueUp).toBeDefined();
    expect(queueUp!.params['max-limit']).toBe('1000k');
    expect(queueDown).toBeDefined();
    expect(queueDown!.params['max-limit']).toBe('2000k');
  });
});

describe('clearSpeedLimit', () => {
  it('removes queue and mangle entries by name/comment', async () => {
    const { transport, removes } = makeTransport();
    const peer = makePeer();

    (transport.print as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
      if (path === '/queue/tree') {
        return [
          { '.id': '*1', name: 'wg-42-up' },
          { '.id': '*2', name: 'wg-42-down' },
          { '.id': '*3', name: 'other' },
        ];
      }
      if (path === '/ip/firewall/mangle') {
        return [
          { '.id': '*4', comment: 'wg-42-up' },
          { '.id': '*5', comment: 'wg-42-down' },
          { '.id': '*6', comment: 'other' },
        ];
      }
      return [];
    });

    await clearSpeedLimit(transport, peer);

    expect(removes).toHaveLength(4);
    expect(removes.filter((r) => r.path === '/queue/tree')).toHaveLength(2);
    expect(removes.filter((r) => r.path === '/ip/firewall/mangle')).toHaveLength(2);
  });

  it('is idempotent when no entries exist', async () => {
    const { transport, removes } = makeTransport();
    const peer = makePeer();

    (transport.print as ReturnType<typeof vi.fn>).mockImplementation(async () => []);

    await clearSpeedLimit(transport, peer);

    expect(removes).toHaveLength(0);
  });
});
