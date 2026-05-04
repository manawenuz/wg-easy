import { writeFile as fsWriteFile } from 'node:fs/promises';
import { exec } from '../utils/cmd';

export class LocalShellTransport {
  async exec(cmd: string): Promise<{ stdout: string; stderr: string }> {
    const stdout = await exec(cmd, { log: true });
    return { stdout, stderr: '' };
  }

  async writeFile(path: string, content: string, mode?: number): Promise<void> {
    await fsWriteFile(path, content, { mode });
  }
}
