import { exec } from '../../../utils/cmd';
import type { EngineType, EngineCapabilities } from '../../../engines/types';
import { getEngine } from '../../../engines/registry';

async function isBinaryAvailable(cmd: string): Promise<boolean> {
  try {
    await exec(`which ${cmd}`, { log: false });
    return true;
  } catch {
    return false;
  }
}

export interface AdminEngineInfo {
  id: EngineType;
  name: string;
  description: string;
  available: boolean;
  capabilities: EngineCapabilities;
  platform: 'linux' | 'mikrotik';
}

export default definePermissionEventHandler('admin', 'any', async () => {
  const [wgAvailable, awgAvailable, boringtunAvailable] = await Promise.all([
    isBinaryAvailable('wg'),
    isBinaryAvailable('awg'),
    isBinaryAvailable('boringtun-cli'),
  ]);

  const engines: AdminEngineInfo[] = [
    {
      id: 'wireguard',
      name: 'WireGuard',
      description:
        'High-performance kernel-based VPN. Best for Linux servers with native WireGuard support.',
      available: wgAvailable,
      capabilities: getEngine('wireguard').capabilities,
      platform: 'linux',
    },
    {
      id: 'amneziawg',
      name: 'AmneziaWG',
      description:
        'WireGuard with packet-shape obfuscation. Requires amneziawg-tools on the host.',
      available: awgAvailable,
      capabilities: getEngine('amneziawg').capabilities,
      platform: 'linux',
    },
    {
      id: 'boringtun',
      name: 'BoringTun',
      description:
        'Userspace WireGuard implementation. Useful when kernel module is unavailable.',
      available: boringtunAvailable,
      capabilities: getEngine('boringtun').capabilities,
      platform: 'linux',
    },
    {
      id: 'mikrotik',
      name: 'MikroTik',
      description:
        'Manage WireGuard peers on a remote MikroTik router via RouterOS API.',
      available: true,
      capabilities: getEngine('mikrotik').capabilities,
      platform: 'mikrotik',
    },
  ];

  return engines;
});
