import { Socket } from 'node:net';
import { connect as tlsConnect, type ConnectionOptions } from 'node:tls';
import debug from 'debug';

const AD_DEBUG = debug('RouterOS:API');

export interface RouterOsApiReply {
  type: '!done' | '!re' | '!trap' | '!fatal';
  attributes: Record<string, string>;
}

export class RouterOsApiProtocol {
  private socket: Socket | null = null;
  private buffer = Buffer.alloc(0);
  private tagCounter = 0;

  constructor(private readonly host: string, private readonly port: number, private readonly useTls: boolean) {}

  async connect(options?: ConnectionOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const connectOptions = {
        host: this.host,
        port: this.port,
        ...options,
      };

      if (this.useTls) {
        this.socket = tlsConnect(connectOptions);
      } else {
        this.socket = new Socket();
        this.socket.connect(this.port, this.host);
      }

      this.socket.on('secureConnect', () => {
        AD_DEBUG('TLS connection established');
        resolve();
      });

      this.socket.on('connect', () => {
        if (!this.useTls) {
          AD_DEBUG('Plain connection established');
          resolve();
        }
      });

      this.socket.on('error', (err) => {
        AD_DEBUG('Socket error:', err);
        reject(err);
      });

      this.socket.on('data', (data) => {
        this.buffer = Buffer.concat([this.buffer, data]);
        this.processBuffer();
      });

      this.socket.on('close', () => {
        AD_DEBUG('Socket closed');
        this.socket = null;
      });
    });
  }

  async send(words: string[]): Promise<RouterOsApiReply[]> {
    if (!this.socket) {
      throw new Error('Not connected');
    }

    const tag = `t${++this.tagCounter}`;
    const sentence = [...words, `.tag=${tag}`];

    for (const word of sentence) {
      const buf = Buffer.from(word, 'utf8');
      this.socket.write(this.encodeLength(buf.length));
      this.socket.write(buf);
    }
    this.socket.write(Buffer.from([0])); // End of sentence

    return this.waitForReply(tag);
  }

  private encodeLength(len: number): Buffer {
    if (len < 0x80) {
      return Buffer.from([len]);
    } else if (len < 0x4000) {
      return Buffer.from([(len >> 8) | 0x80, len & 0xff]);
    } else if (len < 0x200000) {
      return Buffer.from([(len >> 16) | 0xc0, (len >> 8) & 0xff, len & 0xff]);
    } else if (len < 0x10000000) {
      return Buffer.from([(len >> 24) | 0xe0, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
    } else {
      const buf = Buffer.alloc(5);
      buf[0] = 0xf0;
      buf.writeUInt32BE(len, 1);
      return buf;
    }
  }

  private pendingReplies = new Map<string, { replies: RouterOsApiReply[]; resolve: (r: RouterOsApiReply[]) => void }>();

  private waitForReply(tag: string): Promise<RouterOsApiReply[]> {
    return new Promise((resolve) => {
      this.pendingReplies.set(tag, { replies: [], resolve });
    });
  }

  private processBuffer() {
    while (this.buffer.length > 0) {
      const sentence: string[] = [];
      let offset = 0;

      while (true) {
        if (offset >= this.buffer.length) return; // Need more data

        const { length, bytesRead } = this.decodeLength(this.buffer.slice(offset));
        if (length === -1) return; // Need more data

        if (length === 0) {
          // End of sentence
          offset += bytesRead;
          const sentenceBuf = this.buffer.slice(0, offset);
          this.buffer = this.buffer.slice(offset);
          this.handleSentence(sentence);
          break;
        }

        if (offset + bytesRead + length > this.buffer.length) return; // Need more data

        const word = this.buffer.slice(offset + bytesRead, offset + bytesRead + length).toString('utf8');
        sentence.push(word);
        offset += bytesRead + length;
      }
    }
  }

  private decodeLength(buf: Buffer): { length: number; bytesRead: number } {
    if (buf.length === 0) return { length: -1, bytesRead: 0 };

    const b1 = buf[0];
    if ((b1 & 0x80) === 0) {
      return { length: b1, bytesRead: 1 };
    } else if ((b1 & 0xc0) === 0x80) {
      if (buf.length < 2) return { length: -1, bytesRead: 0 };
      return { length: ((b1 & 0x3f) << 8) | buf[1], bytesRead: 2 };
    } else if ((b1 & 0xe0) === 0xc0) {
      if (buf.length < 3) return { length: -1, bytesRead: 0 };
      return { length: ((b1 & 0x1f) << 16) | (buf[1] << 8) | buf[2], bytesRead: 3 };
    } else if ((b1 & 0xf0) === 0xe0) {
      if (buf.length < 4) return { length: -1, bytesRead: 0 };
      return { length: ((b1 & 0x0f) << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3], bytesRead: 4 };
    } else if ((b1 & 0xf8) === 0xf0) {
      if (buf.length < 5) return { length: -1, bytesRead: 0 };
      return { length: buf.readUInt32BE(1), bytesRead: 5 };
    }

    throw new Error('Invalid length prefix');
  }

  private handleSentence(words: string[]) {
    if (words.length === 0) return;

    const type = words[0] as '!done' | '!re' | '!trap' | '!fatal';
    const attributes: Record<string, string> = {};
    let tag = '';

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      if (word.startsWith('=')) {
        const parts = word.slice(1).split('=');
        const key = parts[0];
        const value = parts.slice(1).join('=');
        attributes[key] = value;
      } else if (word.startsWith('.tag=')) {
        tag = word.slice(5);
      }
    }

    const reply: RouterOsApiReply = { type, attributes };
    const pending = this.pendingReplies.get(tag);

    if (pending) {
      pending.replies.push(reply);
      if (type === '!done' || type === '!fatal') {
        this.pendingReplies.delete(tag);
        pending.resolve(pending.replies);
      }
    }
  }

  async login(user: string, password: string): Promise<void> {
    const replies = await this.send(['/login', `=name=${user}`, `=password=${password}`]);
    const fatal = replies.find((r) => r.type === '!fatal');
    if (fatal) {
      throw new Error(fatal.attributes.message || 'Login failed (fatal)');
    }
    const trap = replies.find((r) => r.type === '!trap');
    if (trap) {
      throw new Error(trap.attributes.message || 'Login failed');
    }
  }

  async close() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.pendingReplies.forEach((p) => p.resolve([]));
    this.pendingReplies.clear();
  }
}
