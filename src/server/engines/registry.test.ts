import { describe, it, expect } from 'vitest';
import { getEngine } from './registry';
import { WireguardEngine } from './wireguard';

describe('engine registry', () => {
  it('returns a WireguardEngine for wireguard', () => {
    const engine = getEngine('wireguard');
    expect(engine).toBeInstanceOf(WireguardEngine);
    expect(engine.id).toBe('wireguard');
  });

  it('throws for unregistered engines such as mikrotik', () => {
    expect(() => getEngine('mikrotik')).toThrow(
      "Engine 'mikrotik' is not registered"
    );
  });
});
