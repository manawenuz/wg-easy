import type { UsageSample } from './types';

type WgDumpLine = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string
];

export function parseWgDump(rawDump: string): UsageSample[] {
  return rawDump
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => {
      const splitLines = line.split('\t');
      const [
        publicKey,
        _preSharedKey,
        endpoint,
        _allowedIps,
        latestHandshakeAt,
        transferRx,
        transferTx,
        _persistentKeepalive,
      ] = splitLines as WgDumpLine;

      return {
        publicKey,
        rxBytes: BigInt(transferRx),
        txBytes: BigInt(transferTx),
        lastHandshakeAt:
          latestHandshakeAt === '0'
            ? null
            : new Date(Number.parseInt(`${latestHandshakeAt}000`)),
        endpoint: endpoint === '(none)' ? null : endpoint,
      };
    });
}

export function generateRandomHeaderValue(): number {
  return Math.floor(Math.random() * 2147483642) + 5;
}
