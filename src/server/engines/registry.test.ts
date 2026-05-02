import { describe, it, expect } from 'vitest';
import { getEngine } from './registry';
import { WireguardEngine } from './wireguard';
import { MikrotikEngine } from './mikrotik';

describe('engine registry', () => {
  it('returns a WireguardEngine for wireguard', () => {
    const engine = getEngine('wireguard');
    expect(engine).toBeInstanceOf(WireguardEngine);
    expect(engine.id).toBe('wireguard');
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
