import type { UsageSample } from '../types';

export interface RouterOsPeerStats {
  '.id'?: string;
  comment?: string;
  'public-key'?: string;
  publicKey?: string;
  rx?: string;
  tx?: string;
  'last-handshake'?: string;
  lastHandshake?: string;
  endpoint?: string;
}

export function parseUsageSamples(rows: RouterOsPeerStats[]): UsageSample[] {
  return rows.map((row) => {
    const publicKey = String(row['public-key'] ?? row.publicKey ?? '');
    const rxStr = String(row.rx ?? '0');
    const txStr = String(row.tx ?? '0');
    const lastHandshakeStr = String(row['last-handshake'] ?? row.lastHandshake ?? '0');

    const rxBytes = rxStr ? BigInt(rxStr) : 0n;
    const txBytes = txStr ? BigInt(txStr) : 0n;
    const lastHandshakeSec = Number.parseInt(lastHandshakeStr, 10);
    const lastHandshakeAt =
      Number.isNaN(lastHandshakeSec) || lastHandshakeSec === 0
        ? null
        : new Date(lastHandshakeSec * 1000);

    return {
      publicKey,
      rxBytes,
      txBytes,
      lastHandshakeAt,
      endpoint: row.endpoint ? String(row.endpoint) : null,
    };
  });
}

export const usage = {
  parseUsageSamples,
};
