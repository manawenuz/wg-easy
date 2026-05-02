import { describe, it, expect } from 'vitest';
import { getEngine } from './registry';
import { WireguardEngine } from './wireguard';
import { AmneziaWgEngine } from './amneziawg';
import { MikrotikEngine } from './mikrotik';

describe('engine registry', () => {
  it('returns a WireguardEngine for wireguard', () => {
    const engine = getEngine('wireguard');
    expect(engine).toBeInstanceOf(WireguardEngine);
    expect(engine.id).toBe('wireguard');
  });

  it('returns an AmneziaWgEngine for amneziawg', () => {
    const engine = getEngine('amneziawg');
    expect(engine).toBeInstanceOf(AmneziaWgEngine);
    expect(engine.id).toBe('amneziawg');
  });

  it('returns a MikrotikEngine for mikrotik', () => {
    const engine = getEngine('mikrotik');
    expect(engine).toBeInstanceOf(MikrotikEngine);
    expect(engine.id).toBe('mikrotik');
  });

  it('throws for unregistered engines such as boringtun', () => {
    expect(() => getEngine('boringtun')).toThrow(
      "Engine 'boringtun' is not registered"
    );
  });
});
