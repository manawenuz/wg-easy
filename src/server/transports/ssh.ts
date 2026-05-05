import { Client, type ConnectConfig } from 'ssh2';
import type { SFTPWrapper } from 'ssh2';

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

  async writeFile(remotePath: string, content: string, mode?: number): Promise<void> {
    await this.#ensureConnected();
    const conn = this.conn!;

    return new Promise((resolve, reject) => {
      conn.sftp((err, sftp: SFTPWrapper) => {
        if (err) {
          return reject(err);
        }

        sftp.writeFile(remotePath, content, { mode }, (writeErr) => {
          sftp.end();
          if (writeErr) {
            return reject(writeErr);
          }
          resolve();
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

  isConnected(): boolean {
    return this.conn !== null;
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

    // Lifetime listeners: keep `end` and `close` attached past the initial
    // handshake so dropped connections null out `this.conn` and the next
    // call re-dials. The earlier version cleaned up *all* listeners on ready,
    // which left a dangling `this.conn` after the socket closed and produced
    // "Not connected" errors that never recovered.
    const dropConn = () => {
      if (this.conn === conn) {
        this.conn = null;
      }
    };
    conn.on('end', dropConn);
    conn.on('close', dropConn);
    conn.on('error', dropConn);

    return new Promise((resolve, reject) => {
      const onReady = () => {
        conn.removeListener('ready', onReady);
        conn.removeListener('error', onHandshakeError);
        this.conn = conn;
        resolve();
      };
      const onHandshakeError = (err: Error) => {
        conn.removeListener('ready', onReady);
        conn.removeListener('error', onHandshakeError);
        reject(err);
      };

      conn.on('ready', onReady);
      conn.on('error', onHandshakeError);
      conn.connect(connectConfig);
    });
  }
}
