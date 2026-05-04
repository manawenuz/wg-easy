import { spawn, type ChildProcess } from 'child_process';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

    // Kill any existing boringtun processes and remove stale socket
    try {
      const { exec } = await import('../../utils/cmd');
      await exec(`pkill -f "boringtun-cli ${iface}"`, { log: false });
    } catch {
      // ignore
    }
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(socketPath);
    } catch {
      // ignore
    }
    // Give daemon processes time to exit
    await new Promise((r) => setTimeout(r, 300));

    const proc = spawn('boringtun-cli', ['--disable-drop-privileges', iface], {
      detached: false,
      stdio: ['ignore', 'ignore', 'ignore'],
    });

    this.processes.set(iface, proc);
    // Only reset restart count on fresh start (not on auto-restart)
    if (!this.restartCounts.has(iface)) {
      this.restartCounts.set(iface, 0);
    }

    BT_DEBUG(`boringtun-cli started for ${iface} (pid ${proc.pid})`);

    proc.on('exit', (code, signal) => {
      BT_DEBUG(
        `boringtun-cli for ${iface} exited (code=${code}, signal=${signal})`
      );
      this.processes.delete(iface);

      // Exit code 0 means daemonization (parent exits after spawning daemon)
      if (code === 0) {
        BT_DEBUG(`boringtun-cli for ${iface} daemonized successfully`);
        return;
      }

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

    // Wait for socket to appear
    const start = Date.now();
    while (Date.now() - start < 5000) {
      try {
        const { access } = await import('node:fs/promises');
        await access(socketPath);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error(`UAPI socket ${socketPath} did not appear within 5000ms`);
  }

  async stop(iface: string): Promise<void> {
    const proc = this.processes.get(iface);
    if (proc) {
      proc.removeAllListeners('exit');
      proc.kill('SIGTERM');
      this.processes.delete(iface);
    }
    this.restartCounts.delete(iface);

    try {
      const { exec } = await import('../../utils/cmd');
      await exec(`pkill -f "boringtun-cli ${iface}"`, { log: false });
    } catch {
      // ignore
    }

    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(this.uapiSocket(iface));
    } catch {
      // ignore
    }
  }

  isRunning(iface: string): boolean {
    return existsSync(this.uapiSocket(iface));
  }
}
