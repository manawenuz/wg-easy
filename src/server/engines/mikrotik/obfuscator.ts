import { randomBytes } from 'node:crypto';
import { SshTransport } from '../../transports/ssh';
import { decrypt } from '../../utils/crypto';
import type { RouterType } from '#db/repositories/router/types';

export interface ObfuscatorConfig {
  interfaceId: string;
  listenPort: number;
  wgTargetPort: number;
  key: string;
  dummyPaddingMin: number;
  dummyPaddingMax: number;
}

export interface DeployOptions {
  ifaceName: string;
  listenPort: number;
  wgTargetPort: number;
  key?: string;
  dummyPaddingMin?: number;
  dummyPaddingMax?: number;
}

const VETH_HOST_IP = '172.17.13.1';
const VETH_CONTAINER_IP = '172.17.13.2';
const VETH_NAME = 'veth-wg-ob';
const CONTAINER_NAME = 'wg-obfuscator';
const MOUNT_NAME = 'wg-obfuscator-config';
const CONFIG_DIR = '/wg-obfuscator';
const CONFIG_FILE = `${CONFIG_DIR}/wg-obfuscator.conf`;

function makeSshTransport(router: RouterType): SshTransport {
  const creds = parseCredentials(router);
  const auth = creds.sshKey
    ? {
        type: 'key' as const,
        privateKey: Buffer.from(creds.sshKey, 'base64').toString('utf8'),
        ...(router.sshPassphraseEncrypted ? { passphrase: decrypt(router.sshPassphraseEncrypted) } : {}),
      }
    : { type: 'password' as const, password: creds.apiPassword ?? '' };

  return new SshTransport({
    host: router.host ?? 'localhost',
    port: router.port ?? 22,
    user: creds.sshUser ?? creds.apiUser ?? 'admin',
    auth,
  });
}

function parseCredentials(router: RouterType): {
  apiUser?: string;
  apiPassword?: string;
  sshUser?: string;
  sshKey?: string;
  sshPassphraseEncrypted?: string;
} {
  if (!router.credentialsEncrypted) {
    return {};
  }
  try {
    const decrypted = decrypt(router.credentialsEncrypted);
    return JSON.parse(decrypted);
  } catch {
    return {};
  }
}

async function execAssert(ssh: SshTransport, cmd: string): Promise<string> {
  const { stdout, stderr, code } = await ssh.exec(cmd);
  if (code !== 0 && code !== null) {
    const err = stderr || stdout || `Command exited with code ${code}`;
    throw new Error(err);
  }
  return stdout;
}

function parseCount(stdout: string): number {
  const n = Number.parseInt(stdout.trim(), 10);
  return Number.isNaN(n) ? 0 : n;
}

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
  router: RouterType,
  opts: DeployOptions
): Promise<ObfuscatorConfig> {
  const ssh = makeSshTransport(router);
  const key = opts.key ?? randomBytes(16).toString('base64');

  try {
    // 1. Ensure veth interface exists
    const vethExists = parseCount(
      await execAssert(ssh, `/interface/veth/print count-only where name="${VETH_NAME}"`)
    );
    if (vethExists === 0) {
      await execAssert(
        ssh,
        `/interface/veth/add name="${VETH_NAME}" address="${VETH_CONTAINER_IP}/24" gateway="${VETH_HOST_IP}"`
      );
    }

    // 2. Ensure IP address on veth
    const ipExists = parseCount(
      await execAssert(ssh, `/ip/address/print count-only where interface="${VETH_NAME}"`)
    );
    if (ipExists === 0) {
      await execAssert(
        ssh,
        `/ip/address/add address="${VETH_HOST_IP}/24" interface="${VETH_NAME}"`
      );
    }

    // 3. Ensure config directory exists
    await execAssert(ssh, `/file/print count-only where name="wg-obfuscator"`);
    // Directory creation is implicit when we write the file

    // 4. Ensure mount point exists
    const mountExists = parseCount(
      await execAssert(ssh, `/container/mounts/print count-only where name="${MOUNT_NAME}"`)
    );
    if (mountExists === 0) {
      await execAssert(
        ssh,
        `/container/mounts/add name="${MOUNT_NAME}" src="${CONFIG_DIR}" dst="/etc/wg-obfuscator"`
      );
    }

    // 5. Ensure container exists
    const containerExists = parseCount(
      await execAssert(ssh, `/container/print count-only where name="${CONTAINER_NAME}"`)
    );
    if (containerExists === 0) {
      await execAssert(
        ssh,
        `/container/add interface="${VETH_NAME}" logging=yes mounts="${MOUNT_NAME}" name="${CONTAINER_NAME}" root-dir="wg-obfuscator-data" start-on-boot=yes remote-image="clustermeerkat/wg-obfuscator:latest"`
      );
    }

    // 6. Write config file
    const config = generateConfig({ ...opts, key });
    // Use /file/set to write content if file exists, or create via echo
    const fileExists = parseCount(
      await execAssert(ssh, `/file/print count-only where name="wg-obfuscator/wg-obfuscator.conf"`)
    );
    if (fileExists === 0) {
      // Create file using /file/add doesn't support content directly.
      // Use a shell redirect via SSH exec
      await execAssert(ssh, `:put "${config.replace(/"/g, '\\"')}" > ${CONFIG_FILE}`);
    } else {
      await execAssert(ssh, `/file/set [find name="wg-obfuscator/wg-obfuscator.conf"] contents="${config.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`);
    }

    // 7. Start container if not running
    const containerRunning = parseCount(
      await execAssert(ssh, `/container/print count-only where name="${CONTAINER_NAME}" and status="running"`)
    );
    if (containerRunning === 0) {
      await execAssert(ssh, `/container/start [find name="${CONTAINER_NAME}"]`);
    }

    // 8. Ensure dstnat rule exists
    const natExists = parseCount(
      await execAssert(
        ssh,
        `/ip/firewall/nat/print count-only where comment="wg-easy:obfuscator"`
      )
    );
    if (natExists === 0) {
      await execAssert(
        ssh,
        `/ip/firewall/nat/add chain=dstnat protocol=udp dst-port=${opts.listenPort} action=dst-nat to-addresses="${VETH_CONTAINER_IP}" to-ports=${opts.listenPort} comment="wg-easy:obfuscator"`
      );
    }

    return {
      interfaceId: opts.ifaceName,
      listenPort: opts.listenPort,
      wgTargetPort: opts.wgTargetPort,
      key,
      dummyPaddingMin: opts.dummyPaddingMin ?? 8,
      dummyPaddingMax: opts.dummyPaddingMax ?? 64,
    };
  } finally {
    await ssh.close();
  }
}

export async function removeObfuscator(router: RouterType): Promise<void> {
  const ssh = makeSshTransport(router);

  try {
    // 1. Stop container if running
    const containerRunning = parseCount(
      await execAssert(ssh, `/container/print count-only where name="${CONTAINER_NAME}" and status="running"`)
    );
    if (containerRunning > 0) {
      await execAssert(ssh, `/container/stop [find name="${CONTAINER_NAME}"]`);
    }

    // 2. Remove container
    const containerExists = parseCount(
      await execAssert(ssh, `/container/print count-only where name="${CONTAINER_NAME}"`)
    );
    if (containerExists > 0) {
      await execAssert(ssh, `/container/remove [find name="${CONTAINER_NAME}"]`);
    }

    // 3. Remove mount point
    const mountExists = parseCount(
      await execAssert(ssh, `/container/mounts/print count-only where name="${MOUNT_NAME}"`)
    );
    if (mountExists > 0) {
      await execAssert(ssh, `/container/mounts/remove [find name="${MOUNT_NAME}"]`);
    }

    // 4. Remove dstnat rules
    const natExists = parseCount(
      await execAssert(ssh, `/ip/firewall/nat/print count-only where comment="wg-easy:obfuscator"`)
    );
    if (natExists > 0) {
      await execAssert(ssh, `/ip/firewall/nat/remove [find comment="wg-easy:obfuscator"]`);
    }

    // 5. Remove veth interface
    const vethExists = parseCount(
      await execAssert(ssh, `/interface/veth/print count-only where name="${VETH_NAME}"`)
    );
    if (vethExists > 0) {
      await execAssert(ssh, `/interface/veth/remove [find name="${VETH_NAME}"]`);
    }

    // 6. Remove config directory (best effort)
    const fileExists = parseCount(
      await execAssert(ssh, `/file/print count-only where name="wg-obfuscator"`)
    );
    if (fileExists > 0) {
      await execAssert(ssh, `/file/remove [find name="wg-obfuscator"]`);
    }
  } finally {
    await ssh.close();
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
