import { spawn, type ChildProcess } from 'child_process';
import { createConnection } from 'net';
import { mkdir, access } from 'node:fs/promises';
import debug from 'debug';

const BT_DEBUG = debug('BoringTun');

export class BoringtunProcessManager {
  private processes = new Map<string, ChildProcess>();
  private restartCounts = new Map<string, number>();
  private readonly maxRestarts = 3;

  uapiSocket(iface: string): string {
    return `/var/run/wireguard/${iface}.sock`;
  }

  async start(iface: string): Promise<void> {
    const socketDir = '/var/run/wireguard';
    const socketPath = this.uapiSocket(iface);

    await mkdir(socketDir, { recursive: true });

    const proc = spawn('boringtun-cli', [iface], {
      detached: false,
      stdio: ['ignore', 'ignore', 'ignore'],
    });

    this.processes.set(iface, proc);
    this.restartCounts.set(iface, 0);

    BT_DEBUG(`boringtun-cli started for ${iface} (pid ${proc.pid})`);

    proc.on('exit', (code, signal) => {
      BT_DEBUG(
        `boringtun-cli for ${iface} exited (code=${code}, signal=${signal})`
      );
      this.processes.delete(iface);

      const restarts = this.restartCounts.get(iface) ?? 0;
      if (restarts < this.maxRestarts) {
        this.restartCounts.set(iface, restarts + 1);
        BT_DEBUG(
          `Restarting boringtun-cli for ${iface} (attempt ${restarts + 1}/${this.maxRestarts})`
        );
        this.start(iface).catch((err) => {
          BT_DEBUG(`Failed to restart boringtun-cli for ${iface}:`, err);
        });
      } else {
        BT_DEBUG(`Max restarts reached for ${iface}, giving up`);
      }
    });

    proc.on('error', (err) => {
      BT_DEBUG(`boringtun-cli for ${iface} error:`, err);
    });

    await waitForSocket(socketPath, 5000);
  }

  async stop(iface: string): Promise<void> {
    const proc = this.processes.get(iface);
    if (proc) {
      proc.removeAllListeners('exit');
      proc.kill('SIGTERM');
      this.processes.delete(iface);
      this.restartCounts.delete(iface);
    }

    try {
      const { exec } = await import('../../utils/cmd');
      await exec(`pkill -f "boringtun-cli ${iface}"`, { log: false });
    } catch {
      // ignore
    }
  }

  isRunning(iface: string): boolean {
    const proc = this.processes.get(iface);
    return proc !== undefined && proc.exitCode === null;
  }
}

async function waitForSocket(
  socketPath: string,
  timeoutMs: number
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      await access(socketPath);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  throw new Error(
    `UAPI socket ${socketPath} did not appear within ${timeoutMs}ms`
  );
}

// UAPI client

export async function uapiRequest(
  socketPath: string,
  request: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = createConnection(socketPath);
    let buffer = '';
    let resolved = false;

    client.setTimeout(5000);

    client.on('connect', () => {
      client.write(request);
    });

    client.on('data', (data) => {
      buffer += data.toString();
      if (buffer.includes('\n\n')) {
        resolved = true;
        client.end();
        resolve(buffer);
      }
    });

    client.on('end', () => {
      if (!resolved) {
        resolve(buffer);
      }
    });

    client.on('error', reject);

    client.on('timeout', () => {
      client.destroy();
      reject(new Error('UAPI request timed out'));
    });
  });
}

export async function uapiSet(
  socketPath: string,
  config: string
): Promise<void> {
  const response = await uapiRequest(socketPath, config + '\n');
  if (!response.includes('errno=0')) {
    throw new Error(`UAPI set failed: ${response.trim()}`);
  }
}

export async function uapiGet(socketPath: string): Promise<string> {
  return uapiRequest(socketPath, 'get=1\n\n');
}

export function parseUapiGet(
  response: string
): Array<{
  publicKey: string;
  rxBytes: bigint;
  txBytes: bigint;
  lastHandshakeAt: Date | null;
  endpoint: string | null;
}> {
  const lines = response.trim().split('\n');
  const samples: Array<{
    publicKey: string;
    rxBytes: bigint;
    txBytes: bigint;
    lastHandshakeAt: Date | null;
    endpoint: string | null;
  }> = [];
  let currentPeer: {
    publicKey?: string;
    rxBytes?: bigint;
    txBytes?: bigint;
    lastHandshakeAt?: Date | null;
    endpoint?: string | null;
  } = {};

  for (const line of lines) {
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx);
    const value = line.slice(eqIdx + 1);

    if (key === 'public_key') {
      if (currentPeer.publicKey) {
        samples.push({
          publicKey: currentPeer.publicKey,
          rxBytes: currentPeer.rxBytes ?? 0n,
          txBytes: currentPeer.txBytes ?? 0n,
          lastHandshakeAt: currentPeer.lastHandshakeAt ?? null,
          endpoint: currentPeer.endpoint ?? null,
        });
      }
      currentPeer = { publicKey: value };
    } else if (currentPeer.publicKey) {
      switch (key) {
        case 'rx_bytes':
          currentPeer.rxBytes = BigInt(value || '0');
          break;
        case 'tx_bytes':
          currentPeer.txBytes = BigInt(value || '0');
          break;
        case 'last_handshake_time_sec': {
          const sec = Number.parseInt(value, 10);
          currentPeer.lastHandshakeAt =
            sec === 0 ? null : new Date(sec * 1000);
          break;
        }
        case 'endpoint':
          currentPeer.endpoint =
            value === '(none)' || !value ? null : value;
          break;
      }
    }
  }

  if (currentPeer.publicKey) {
    samples.push({
      publicKey: currentPeer.publicKey,
      rxBytes: currentPeer.rxBytes ?? 0n,
      txBytes: currentPeer.txBytes ?? 0n,
      lastHandshakeAt: currentPeer.lastHandshakeAt ?? null,
      endpoint: currentPeer.endpoint ?? null,
    });
  }

  return samples;
}
