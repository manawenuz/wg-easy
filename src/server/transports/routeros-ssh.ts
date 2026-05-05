import { SshTransport } from './ssh';

export type RouterOsRow = Record<string, unknown>;

export class RouterOsSshTransport {
  constructor(private readonly ssh: SshTransport) {}

  async connect(): Promise<void> {
    // SshTransport handles connection internally on first exec
  }

  async write(
    path: string,
    params: Record<string, string | number | boolean>
  ): Promise<RouterOsRow[]> {
    const cmd = `${path} add ${this.#paramsToString(params)}`;
    const { stdout, stderr, code } = await this.ssh.exec(cmd);
    if (code !== 0) {
      throw new Error(`MikroTik SSH error (code ${code}): ${stderr || stdout}`);
    }
    return [{}];
  }

  async print(path: string, query?: Record<string, string | number | boolean>): Promise<RouterOsRow[]> {
    // Try print detail terse first as it is best for lists
    let cmd = `${path} print detail terse show-ids`;
    let filters: string[] = [];
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === '') {
          cmd += ` ${key}`;
        } else {
          filters.push(`${key}=${this.#quote(value)}`);
        }
      }
    }
    if (filters.length > 0) {
      cmd += ` where ${filters.join(' and ')}`;
    }
    let { stdout, stderr, code } = await this.ssh.exec(cmd);
    
    // Fallback to plain print if detail terse is not supported
    if (code !== 0) {
      cmd = `${path} print`;
      filters = [];
      if (query) {
        for (const [key, value] of Object.entries(query)) {
          if (value === '') {
            cmd += ` ${key}`;
          } else {
            filters.push(`${key}=${this.#quote(value)}`);
          }
        }
      }
      if (filters.length > 0) {
        cmd += ` where ${filters.join(' and ')}`;
      }
      const fallback = await this.ssh.exec(cmd);
      stdout = fallback.stdout;
      stderr = fallback.stderr;
      code = fallback.code;
    }

    if (code !== 0) {
      throw new Error(`MikroTik SSH error (code ${code}): ${stderr || stdout}`);
    }
    return this.#parseTerse(stdout);
  }

  async set(
    path: string,
    id: string,
    params: Record<string, string | number | boolean>
  ): Promise<RouterOsRow[]> {
    const selector = id.startsWith('*') ? `[find where .id=${id}]` : id;
    const cmd = `${path} set ${selector} ${this.#paramsToString(params)}`;
    const { stdout, stderr, code } = await this.ssh.exec(cmd);
    if (code !== 0) {
      throw new Error(`MikroTik SSH error (code ${code}): ${stderr || stdout}`);
    }
    return [{}];
  }

  async remove(path: string, id: string): Promise<RouterOsRow[]> {
    const selector = id.startsWith('*') ? `[find where .id=${id}]` : id;
    const cmd = `${path} remove ${selector}`;
    const { stdout, stderr, code } = await this.ssh.exec(cmd);
    if (code !== 0) {
      throw new Error(`MikroTik SSH error (code ${code}): ${stderr || stdout}`);
    }
    return [{}];
  }

  async exec(path: string, command: string, data?: Record<string, unknown>): Promise<RouterOsRow[]> {
    let cmd = `${path} ${command}`;
    if (data) {
      cmd += ` ${this.#paramsToString(data as Record<string, string | number | boolean>)}`;
    }
    const { stdout, stderr, code } = await this.ssh.exec(cmd);
    if (code !== 0) {
      throw new Error(`MikroTik SSH error (code ${code}): ${stderr || stdout}`);
    }
    return [{}];
  }

  async close(): Promise<void> {
    await this.ssh.close();
  }

  isConnected(): boolean {
    return this.ssh.isConnected();
  }

  getLastError(): Error | null {
    return null;
  }

  scheduleReconnect(): void {
  }

  #paramsToString(params: Record<string, string | number | boolean>): string {
    return Object.entries(params)
      .map(([key, value]) => `${key}=${this.#quote(value)}`)
      .join(' ');
  }

  #quote(value: string | number | boolean): string {
    if (typeof value === 'boolean') {
      return value ? 'yes' : 'no';
    }
    const str = String(value);
    if (str.includes(' ') || str.includes('=') || str === '') {
      return `"${str.replace(/"/g, '\\"')}"`;
    }
    return str;
  }

  #parseTerse(output: string): RouterOsRow[] {
    const lines = output.split('\r\n').flatMap(l => l.split('\n')).filter(l => l.trim());
    const results: RouterOsRow[] = [];
    const now = Math.floor(Date.now() / 1000);
    
    // Check if it's the terse format (starts with index or *ID)
    const isTerse = lines.some(l => /^\s*(\d+|\*[\w-]+)\s+/.test(l));
    
    if (isTerse) {
      for (const line of lines) {
        const row: RouterOsRow = {};
        const indexMatch = line.match(/^\s*(\d+|\*[\w-]+)\s+(.*)$/);
        if (indexMatch) {
          const idOrIndex = indexMatch[1] as string;
          if (idOrIndex.startsWith('*')) {
            row['id'] = idOrIndex;
            row['.id'] = idOrIndex;
          } else {
            row['index'] = idOrIndex;
          }
          const content = indexMatch[2];
          const pairs = content.matchAll(/(\.?[\w-]+)=("[^"\\]*(?:\\.[^"\\]*)*"|\S+)/g);
          for (const [_, key, value] of pairs) {
            let val = value;
            if (val.startsWith('"') && val.endsWith('"')) {
              val = val.slice(1, -1).replace(/\\"/g, '"');
            }
            if (key === 'rx' || key === 'tx') {
              val = String(this.#parseSize(val));
            } else if (key === 'last-handshake') {
              const duration = this.#parseDuration(val);
              val = duration > 0 ? String(now - duration) : '0';
            }
            row[key] = val;
          }
          if (row['.id']) row['id'] = row['.id'];
          results.push(row);
        }
      }
    } else {
      let currentRow: RouterOsRow = {};
      for (const line of lines) {
        const match = line.match(/^\s*([\w.-]+):\s*(.*)$/);
        if (match) {
          const key = match[1];
          let val = match[2].trim();
          if (key === 'rx' || key === 'tx') {
            val = String(this.#parseSize(val));
          } else if (key === 'last-handshake') {
            const duration = this.#parseDuration(val);
            val = duration > 0 ? String(now - duration) : '0';
          }
          currentRow[key] = val;
        }
      }
      if (Object.keys(currentRow).length > 0) {
        results.push(currentRow);
      }
    }
    
    return results;
  }

  #parseSize(val: string): bigint {
    const match = val.match(/^([\d.]+)([KMGT]iB)?$/);
    if (!match) return 0n;
    const num = parseFloat(match[1]);
    const unit = match[2];
    let factor = 1n;
    switch (unit) {
      case 'KiB': factor = 1024n; break;
      case 'MiB': factor = 1024n * 1024n; break;
      case 'GiB': factor = 1024n * 1024n * 1024n; break;
      case 'TiB': factor = 1024n * 1024n * 1024n * 1024n; break;
    }
    return BigInt(Math.floor(num * Number(factor)));
  }

  #parseDuration(val: string): number {
    if (val === '0' || !val) return 0;
    const regex = /(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/;
    const match = val.match(regex);
    if (!match) return 0;
    const w = parseInt(match[1] || '0');
    const d = parseInt(match[2] || '0');
    const h = parseInt(match[3] || '0');
    const m = parseInt(match[4] || '0');
    const s = parseInt(match[5] || '0');
    return w * 7 * 24 * 3600 + d * 24 * 3600 + h * 3600 + m * 60 + s;
  }
}
