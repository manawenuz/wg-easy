import { describe, it, expect } from 'vitest';
import { parseUsageSamples } from './usage';

describe('parseUsageSamples', () => {
  it('parses basic stats', () => {
    const rows = [
      { 'public-key': 'pk1', rx: '1024', tx: '2048', 'last-handshake': '1714656000', endpoint: '1.2.3.4:51820' },
      { 'public-key': 'pk2', rx: '0', tx: '0', 'last-handshake': '0' },
    ];

    const samples = parseUsageSamples(rows);

    expect(samples).toHaveLength(2);
    expect(samples[0]!.publicKey).toBe('pk1');
    expect(samples[0]!.rxBytes).toBe(1024n);
    expect(samples[0]!.txBytes).toBe(2048n);
    expect(samples[0]!.lastHandshakeAt).toEqual(new Date(1714656000 * 1000));
    expect(samples[0]!.endpoint).toBe('1.2.3.4:51820');

    expect(samples[1]!.publicKey).toBe('pk2');
    expect(samples[1]!.lastHandshakeAt).toBeNull();
  });

  it('handles camelCase properties', () => {
    const rows = [
      { publicKey: 'pk3', rx: '100', tx: '200', lastHandshake: '0' },
    ];

    const samples = parseUsageSamples(rows);

    expect(samples[0]!.publicKey).toBe('pk3');
    expect(samples[0]!.rxBytes).toBe(100n);
  });

  it('handles missing optional fields', () => {
    const rows = [{ 'public-key': 'pk4' }];

    const samples = parseUsageSamples(rows);

    expect(samples[0]!.rxBytes).toBe(0n);
    expect(samples[0]!.txBytes).toBe(0n);
    expect(samples[0]!.lastHandshakeAt).toBeNull();
    expect(samples[0]!.endpoint).toBeNull();
  });
});
