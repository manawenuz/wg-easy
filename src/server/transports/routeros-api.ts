import { RouterOSClient } from 'routeros-client';
import type { RosApiMenu } from 'routeros-client';

export interface RouterOsApiOptions {
  host: string;
  port?: number;
  user: string;
  password: string;
  tls?: boolean;
}

export type RouterOsRow = Record<string, unknown>;

export class RouterOsApiTransport {
  private client: RouterOSClient | null = null;
  private api: RosApiMenu | null = null;
  private connecting = false;
  private lastError: Error | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: RouterOsApiOptions) {}

  async connect(): Promise<void> {
    if (this.api) {
      return;
    }
    if (this.connecting) {
      await this.#waitForConnect();
      return;
    }

    this.connecting = true;
    this.lastError = null;

    try {
      const client = new RouterOSClient({
        host: this.opts.host,
        port: this.opts.port ?? (this.opts.tls ? 8729 : 8728),
        user: this.opts.user,
        password: this.opts.password,
        ...(this.opts.tls ? { tls: { rejectUnauthorized: false } } : {}),
      });

      const api = await client.connect();
      this.client = client;
      this.api = api;
      this.reconnectAttempts = 0;
    } catch (err) {
      this.lastError = err instanceof Error ? err : new Error(String(err));
      throw this.lastError;
    } finally {
      this.connecting = false;
    }
  }

  async write(
    path: string,
    params: Record<string, string | number | boolean>
  ): Promise<RouterOsRow[]> {
    await this.connect();
    const result = await this.api!.menu(path).add(params as Record<string, unknown>);
    return Array.isArray(result) ? result : [result];
  }

  async print(path: string, query?: Record<string, string | number | boolean>): Promise<RouterOsRow[]> {
    await this.connect();
    const menu = this.api!.menu(path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        menu.where(key, String(value));
      }
    }
    const result = await menu.getAll();
    return Array.isArray(result) ? result : [];
  }

  async set(
    path: string,
    id: string,
    params: Record<string, string | number | boolean>
  ): Promise<RouterOsRow[]> {
    await this.connect();
    const result = await this.api!.menu(path).set(params as Record<string, unknown>, id);
    return Array.isArray(result) ? result : [result];
  }

  async remove(path: string, id: string): Promise<RouterOsRow[]> {
    await this.connect();
    const result = await this.api!.menu(path).remove(id);
    return Array.isArray(result) ? result : [result];
  }

  async exec(path: string, command: string, data?: Record<string, unknown>): Promise<RouterOsRow[]> {
    await this.connect();
    const result = await this.api!.menu(path).exec(command, data);
    return Array.isArray(result) ? result : [result];
  }

  async close(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // ignore
      }
      this.client = null;
      this.api = null;
    }
  }

  isConnected(): boolean {
    return this.client?.isConnected() ?? false;
  }

  getLastError(): Error | null {
    return this.lastError;
  }

  scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 5 * 60 * 1000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.close().then(() => {
        this.connect().catch(() => {
          // Backoff will retry on next operation
        });
      });
    }, delay);
  }

  #waitForConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.api) {
          resolve();
        } else if (!this.connecting) {
          reject(this.lastError ?? new Error('Connection failed'));
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }
}
