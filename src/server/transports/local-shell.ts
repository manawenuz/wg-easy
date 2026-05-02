import { exec } from '../utils/cmd';

export class LocalShellTransport {
  async exec(cmd: string): Promise<{ stdout: string; stderr: string }> {
    const stdout = await exec(cmd, { log: true });
    return { stdout, stderr: '' };
  }
}
