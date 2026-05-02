import { Client, type ConnectConfig } from 'ssh2';

export type SshAuth =
  | { type: 'password'; password: string }
  | { type: 'key'; privateKey: string; passphrase?: string };

export interface SshTransportOptions {
  host: string;
  port?: number;
  user: string;
  auth: SshAuth;
}

export class SshTransport {
  private conn: Client | null = null;

  constructor(private readonly opts: SshTransportOptions) {}

  async exec(cmd: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
    await this.#ensureConnected();
    const conn = this.conn!;

    return new Promise((resolve, reject) => {
      conn.exec(cmd, (err, stream) => {
        if (err) {
          return reject(err);
        }

        let stdout = '';
        let stderr = '';
        let code: number | null = null;

        stream.on('data', (data: Buffer) => {
          stdout += data.toString('utf8');
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString('utf8');
        });

        stream.on('close', (exitCode: number | null) => {
          code = exitCode;
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
        });

        stream.on('error', (err: Error) => {
          reject(err);
        });
      });
    });
  }

  async close(): Promise<void> {
    if (this.conn) {
      this.conn.end();
      this.conn = null;
    }
  }

  async #ensureConnected(): Promise<void> {
    if (this.conn) {
      return;
    }

    const conn = new Client();
    const auth = this.opts.auth;

    const connectConfig: ConnectConfig = {
      host: this.opts.host,
      port: this.opts.port ?? 22,
      username: this.opts.user,
    };

    if (auth.type === 'password') {
      connectConfig.password = auth.password;
    } else {
      connectConfig.privateKey = auth.privateKey;
      if (auth.passphrase) {
        connectConfig.passphrase = auth.passphrase;
      }
    }

    return new Promise((resolve, reject) => {
      conn.on('ready', () => {
        this.conn = conn;
        resolve();
      });
      conn.on('error', (err) => {
        reject(err);
      });
      conn.connect(connectConfig);
    });
  }
}
