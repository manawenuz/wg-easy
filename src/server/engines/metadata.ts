import { exec } from '../utils/cmd';
import type { EngineType, EngineCapabilities } from './types';
import { getEngine } from './registry';
import fs from 'node:fs';

async function isBinaryAvailable(cmd: string): Promise<boolean> {
  try {
    await exec(`which ${cmd}`, { log: false });
    return true;
  } catch {
    return false;
  }
}

function isDockerized(): boolean {
  try {
    if (fs.existsSync('/.dockerenv')) return true;
    const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
    return cgroup.includes('docker');
  } catch {
    return false;
  }
}

async function isDockerAvailable(): Promise<boolean> {
  try {
    await exec('which docker', { log: false });
    return true;
  } catch {
    return false;
  }
}

export interface EngineMetadata {
  id: EngineType;
  name: string;
  description: string;
  available: boolean;
  dockerized: boolean;
  capabilities: EngineCapabilities;
  platform: 'linux' | 'mikrotik';
}

export async function getEngineMetadata(): Promise<EngineMetadata[]> {
  const [wgAvailable, awgAvailable, boringtunAvailable, dockerAvailable] = await Promise.all([
    isBinaryAvailable('wg'),
    isBinaryAvailable('awg'),
    isBinaryAvailable('boringtun-cli'),
    isDockerAvailable(),
  ]);

  const dockerized = isDockerized();

  return [
    {
      id: 'wireguard',
      name: 'WireGuard',
      description:
        'High-performance kernel-based VPN. Best for Linux servers with native WireGuard support.',
      available: wgAvailable,
      dockerized,
      capabilities: getEngine('wireguard').capabilities,
      platform: 'linux',
    },
    {
      id: 'amneziawg',
      name: 'AmneziaWG',
      description:
        'WireGuard with packet-shape obfuscation. Requires amneziawg-tools on the host.',
      available: awgAvailable || dockerAvailable,
      dockerized,
      capabilities: getEngine('amneziawg').capabilities,
      platform: 'linux',
    },
    {
      id: 'boringtun',
      name: 'BoringTun',
      description:
        'Userspace WireGuard implementation. Useful when kernel module is unavailable.',
      available: boringtunAvailable,
      dockerized,
      capabilities: getEngine('boringtun').capabilities,
      platform: 'linux',
    },
    {
      id: 'mikrotik',
      name: 'MikroTik',
      description:
        'Manage WireGuard peers on a remote MikroTik router via RouterOS API.',
      available: true,
      dockerized: false,
      capabilities: getEngine('mikrotik').capabilities,
      platform: 'mikrotik',
    },
  ];
}
