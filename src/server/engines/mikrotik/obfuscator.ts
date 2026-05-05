import { randomBytes } from 'node:crypto';
import type { RouterOsApiTransport } from '../../transports/routeros-api';
import type { RouterOsSshTransport } from '../../transports/routeros-ssh';

export type MikrotikTransport = RouterOsApiTransport | RouterOsSshTransport;

export interface ObfuscatorConfig {
  interfaceId: string;
  listenPort: number;
  wgTargetPort: number;
  key: string;
  dummyPaddingMin: number;
  dummyPaddingMax: number;
  deployEnabled: boolean;
}

export interface DeployOptions {
  ifaceName: string;
  listenPort: number;
  wgTargetPort: number;
  key?: string;
  dummyPaddingMin?: number;
  dummyPaddingMax?: number;
  deployEnabled?: boolean;
}

const VETH_HOST_IP = '172.17.13.1';
const VETH_CONTAINER_IP = '172.17.13.2';
const VETH_NAME = 'veth-wg-ob';
const CONTAINER_NAME = 'wg-obfuscator';
const MOUNT_NAME = 'wg-obfuscator-config';
const CONFIG_DIR = '/wg-obfuscator';
const CONFIG_FILE = `${CONFIG_DIR}/wg-obfuscator.conf`;

function generateConfig(opts: DeployOptions): string {
  const key = opts.key ?? randomBytes(16).toString('base64');
  const maxDummy = opts.dummyPaddingMax ?? 64;
  return `[main]
source-lport = ${opts.listenPort}
target = ${VETH_HOST_IP}:${opts.wgTargetPort}
key = ${key}
verbose = 2
max-dummy = ${maxDummy}
`;
}

export async function deployObfuscator(
  transport: MikrotikTransport,
  opts: DeployOptions
): Promise<ObfuscatorConfig> {
  const key = opts.key ?? randomBytes(16).toString('base64');

  if (opts.deployEnabled) {
    // 1. Ensure veth interface exists
    const veths = await transport.print('/interface/veth', { name: VETH_NAME });
    if (veths.length === 0) {
      await transport.write('/interface/veth', {
        name: VETH_NAME,
        address: `${VETH_CONTAINER_IP}/24`,
        gateway: VETH_HOST_IP,
      });
    }

    // 2. Ensure IP address on veth
    const ips = await transport.print('/ip/address', { interface: VETH_NAME });
    if (ips.length === 0) {
      await transport.write('/ip/address', {
        address: `${VETH_HOST_IP}/24`,
        interface: VETH_NAME,
      });
    }

    // 3. Ensure mount point exists
    const mounts = await transport.print('/container/mounts', { name: MOUNT_NAME });
    if (mounts.length === 0) {
      await transport.write('/container/mounts', {
        name: MOUNT_NAME,
        src: CONFIG_DIR,
        dst: '/etc/wg-obfuscator',
      });
    }

    // 4. Ensure container exists
    const containers = await transport.print('/container', { name: CONTAINER_NAME });
    if (containers.length === 0) {
      await transport.write('/container', {
        name: CONTAINER_NAME,
        interface: VETH_NAME,
        logging: 'yes',
        mounts: MOUNT_NAME,
        'root-dir': 'wg-obfuscator-data',
        'start-on-boot': 'yes',
        'remote-image': 'clustermeerkat/wg-obfuscator:latest',
      });
    }

    // 5. Write config file
    const config = generateConfig({ ...opts, key });
    const files = await transport.print('/file', { name: 'wg-obfuscator/wg-obfuscator.conf' });
    if (files.length === 0) {
      await transport.exec('/file', 'add', {
        name: 'wg-obfuscator/wg-obfuscator.conf',
        contents: config,
      });
    } else {
      const id = String(files[0]!['.id'] ?? files[0]!.id ?? files[0]!.name);
      await transport.set('/file', id, { contents: config });
    }

    // 6. Start container if not running
    const running = await transport.print('/container', {
      name: CONTAINER_NAME,
      status: 'running',
    });
    if (running.length === 0) {
      const allContainers = await transport.print('/container', { name: CONTAINER_NAME });
      if (allContainers.length > 0) {
        const id = String(allContainers[0]!['.id'] ?? allContainers[0]!.id);
        await transport.exec('/container', 'start', { '.id': id });
      }
    }

    // 7. Ensure dstnat rule exists
    const nats = await transport.print('/ip/firewall/nat', {
      comment: 'wg-easy:obfuscator',
    });
    if (nats.length === 0) {
      await transport.write('/ip/firewall/nat', {
        chain: 'dstnat',
        protocol: 'udp',
        'dst-port': opts.listenPort,
        action: 'dst-nat',
        'to-addresses': VETH_CONTAINER_IP,
        'to-ports': opts.listenPort,
        comment: 'wg-easy:obfuscator',
      });
    }
  }

  return {
    interfaceId: opts.ifaceName,
    listenPort: opts.listenPort,
    wgTargetPort: opts.wgTargetPort,
    key,
    dummyPaddingMin: opts.dummyPaddingMin ?? 8,
    dummyPaddingMax: opts.dummyPaddingMax ?? 64,
    deployEnabled: opts.deployEnabled ?? false,
  };
}

export async function removeObfuscator(transport: MikrotikTransport): Promise<void> {
  // 1. Stop and remove container
  const containers = await transport.print('/container', { name: CONTAINER_NAME });
  if (containers.length > 0) {
    const id = String(containers[0]!['.id'] ?? containers[0]!.id);
    if (containers[0]!.status === 'running') {
      await transport.exec('/container', 'stop', { '.id': id });
    }
    await transport.remove('/container', id);
  }

  // 2. Remove mount point
  const mounts = await transport.print('/container/mounts', { name: MOUNT_NAME });
  if (mounts.length > 0) {
    const id = String(mounts[0]!['.id'] ?? mounts[0]!.id);
    await transport.remove('/container/mounts', id);
  }

  // 3. Remove dstnat rules
  const nats = await transport.print('/ip/firewall/nat', {
    comment: 'wg-easy:obfuscator',
  });
  if (nats.length > 0) {
    for (const nat of nats) {
      const id = String(nat['.id'] ?? nat.id);
      await transport.remove('/ip/firewall/nat', id);
    }
  }

  // 4. Remove veth interface
  const veths = await transport.print('/interface/veth', { name: VETH_NAME });
  if (veths.length > 0) {
    const id = String(veths[0]!['.id'] ?? veths[0]!.id);
    await transport.remove('/interface/veth', id);
  }

  // 5. Remove IP address
  const ips = await transport.print('/ip/address', { interface: VETH_NAME });
  if (ips.length > 0) {
    for (const ip of ips) {
      const id = String(ip['.id'] ?? ip.id);
      await transport.remove('/ip/address', id);
    }
  }

  // 6. Remove config directory (best effort)
  const files = await transport.print('/file', { name: 'wg-obfuscator' });
  if (files.length > 0) {
    const id = String(files[0]!['.id'] ?? files[0]!.id ?? files[0]!.name);
    await transport.remove('/file', id);
  }
}

export function generateClientObfuscatorConfig(
  routerHost: string,
  obfuscatorConfig: ObfuscatorConfig
): string {
  return `# WireGuard Obfuscator client configuration
# Install wg-obfuscator from https://github.com/ClusterM/wg-obfuscator
# Run: wg-obfuscator --config /path/to/this/file.conf

[main]
source-lport = 51830
target = ${routerHost}:${obfuscatorConfig.listenPort}
key = ${obfuscatorConfig.key}
verbose = 2
`;
}
