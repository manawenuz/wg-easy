import { describe, it, expect } from 'vitest';
import type { Client } from '../types';
import { diffPeers, generatePeerParams } from './configgen';
import type { InterfaceType } from '#db/repositories/interface/types';

function makeIface(overrides: Partial<InterfaceType> = {}): InterfaceType {
  return {
    name: 'wg1',
    device: 'eth0',
    port: 51820,
    privateKey: 'priv',
    publicKey: 'pub',
    ipv4Cidr: '10.8.0.0/24',
    ipv6Cidr: 'fd00::/64',
    mtu: 1420,
    enabled: true,
    firewallEnabled: false,
    engineType: 'mikrotik',
    routerId: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as InterfaceType;
}

function makePeer(overrides: Partial<Client> = {}): Client {
  return {
    id: 1,
    userId: 1,
    interfaceId: 'wg1',
    name: 'alice',
    publicKey: 'pk1',
    privateKey: 'priv1',
    preSharedKey: 'psk1',
    ipv4Address: '10.8.0.2',
    ipv6Address: 'fd00::2',
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

describe('generatePeerParams', () => {
  it('generates correct params for enabled peer', () => {
    const iface = makeIface();
    const peer = makePeer();
    const params = generatePeerParams(iface, peer, true);

    expect(params.interface).toBe('wg1');
    expect(params['public-key']).toBe('pk1');
    expect(params['allowed-address']).toBe('10.8.0.2/32,fd00::2/128');
    expect(params['preshared-key']).toBe('psk1');
    expect(params.comment).toBe('1:alice');
    expect(params.disabled).toBe('no');
  });

  it('generates correct params for disabled peer', () => {
    const iface = makeIface();
    const peer = makePeer({ enabled: false });
    const params = generatePeerParams(iface, peer, true);

    expect(params.disabled).toBe('yes');
  });

  it('omits ipv6 when disabled', () => {
    const iface = makeIface();
    const peer = makePeer();
    const params = generatePeerParams(iface, peer, false);

    expect(params['allowed-address']).toBe('10.8.0.2/32');
  });
});

describe('diffPeers', () => {
  it('adds missing peers', () => {
    const iface = makeIface();
    const peer = makePeer();
    const ops = diffPeers(iface, [peer], [], true);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.action).toBe('add');
  });

  it('removes orphaned peers', () => {
    const iface = makeIface();
    const actual = [
      { '.id': '*1A', comment: '1:alice', 'public-key': 'old', 'allowed-address': '10.0.0.1/32', 'preshared-key': 'oldpsk', disabled: 'no' },
    ];
    const ops = diffPeers(iface, [], actual, true);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.action).toBe('remove');
    expect((ops[0] as { id: string }).id).toBe('*1A');
  });

  it('updates changed peers', () => {
    const iface = makeIface();
    const peer = makePeer({ publicKey: 'pk2' });
    const actual = [
      { '.id': '*2B', comment: '1:alice', 'public-key': 'pk1', 'allowed-address': '10.8.0.2/32,fd00::2/128', 'preshared-key': 'psk1', disabled: 'no' },
    ];
    const ops = diffPeers(iface, [peer], actual, true);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.action).toBe('set');
    expect((ops[0] as { id: string }).id).toBe('*2B');
  });

  it('does nothing when peers match', () => {
    const iface = makeIface();
    const peer = makePeer();
    const actual = [
      { '.id': '*3C', comment: '1:alice', 'public-key': 'pk1', 'allowed-address': '10.8.0.2/32,fd00::2/128', 'preshared-key': 'psk1', disabled: 'no' },
    ];
    const ops = diffPeers(iface, [peer], actual, true);

    expect(ops).toHaveLength(0);
  });
});
