import { RouterOsApiProtocol, type RouterOsApiReply } from './routeros-api-protocol';
import { checkServerIdentity } from './tls-pin';

export interface RouterOsApiOptions {
  host: string;
  port?: number;
  user: string;
  password: string;
  tls?: boolean;
  tlsFingerprint?: string;
}

export type RouterOsRow = Record<string, unknown>;

export class RouterOsApiTransport {
  private protocol: RouterOsApiProtocol | null = null;
  private connecting = false;
  private lastError: Error | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: RouterOsApiOptions) {}

  async connect(): Promise<void> {
    if (this.protocol) {
      return;
    }
    if (this.connecting) {
      await this.#waitForConnect();
      return;
    }

    this.connecting = true;
    this.lastError = null;

    try {
      const useTls = this.opts.tls ?? true;
      const port = this.opts.port ?? (useTls ? 8729 : 8728);

      const protocol = new RouterOsApiProtocol(this.opts.host, port, useTls);

      await protocol.connect({
        checkServerIdentity: (hostname, cert) => {
          if (useTls && this.opts.tlsFingerprint) {
            return checkServerIdentity(hostname, cert, this.opts.tlsFingerprint);
          }
          return undefined;
        },
        rejectUnauthorized: !!(useTls && this.opts.tlsFingerprint),
      });

      await protocol.login(this.opts.user, this.opts.password);
      this.protocol = protocol;
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
    const words = [path + '/add', ...Object.entries(params).map(([k, v]) => `=${k}=${v}`)];
    const replies = await this.protocol!.send(words);
    this.#handleErrors(replies);
    return this.#parseReplies(replies);
  }

  async print(path: string, query?: Record<string, string | number | boolean>): Promise<RouterOsRow[]> {
    await this.connect();
    const words = [path + '/print'];
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        words.push(`?${key}=${value}`);
      }
    }
    const replies = await this.protocol!.send(words);
    this.#handleErrors(replies);
    return this.#parseReplies(replies);
  }

  async set(
    path: string,
    id: string,
    params: Record<string, string | number | boolean>
  ): Promise<RouterOsRow[]> {
    await this.connect();
    const words = [path + '/set', `=.id=${id}`, ...Object.entries(params).map(([k, v]) => `=${k}=${v}`)];
    const replies = await this.protocol!.send(words);
    this.#handleErrors(replies);
    return this.#parseReplies(replies);
  }

  async remove(path: string, id: string): Promise<RouterOsRow[]> {
    await this.connect();
    const words = [path + '/remove', `=.id=${id}`];
    const replies = await this.protocol!.send(words);
    this.#handleErrors(replies);
    return this.#parseReplies(replies);
  }

  async exec(path: string, command: string, data?: Record<string, unknown>): Promise<RouterOsRow[]> {
    await this.connect();
    const words = [`${path}/${command}`];
    if (data) {
      for (const [k, v] of Object.entries(data)) {
        words.push(`=${k}=${v}`);
      }
    }
    const replies = await this.protocol!.send(words);
    this.#handleErrors(replies);
    return this.#parseReplies(replies);
  }

  async close(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.protocol) {
      try {
        await this.protocol.close();
      } catch {
        // ignore
      }
      this.protocol = null;
    }
  }

  isConnected(): boolean {
    return this.protocol !== null;
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
        if (this.protocol) {
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

  #handleErrors(replies: RouterOsApiReply[]) {
    const fatal = replies.find((r) => r.type === '!fatal');
    if (fatal) {
      throw new Error(fatal.attributes.message || 'Fatal RouterOS API error');
    }
    const trap = replies.find((r) => r.type === '!trap');
    if (trap) {
      throw new Error(trap.attributes.message || 'RouterOS API error');
    }
  }

  #parseReplies(replies: RouterOsApiReply[]): RouterOsRow[] {
    return replies.filter((r) => r.type === '!re').map((r) => r.attributes);
  }
}
