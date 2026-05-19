import { readFileSync } from 'node:fs';
import { createDebug } from 'obug';
import packageJson from '@@/package.json';

export const RELEASE = 'v' + packageJson.version;

export const SERVER_DEBUG = createDebug('Server');

export const OLD_ENV = {
  /** @deprecated Only for migration purposes */
  PASSWORD: process.env.PASSWORD,
  /** @deprecated Only for migration purposes */
  PASSWORD_HASH: process.env.PASSWORD_HASH,
};

const detectAwg = async (): Promise<'awg' | 'wg'> => {
  /** TODO: delete on next major version */
  if (process.env.EXPERIMENTAL_AWG === 'true') {
    const OVERRIDE_AUTO_AWG = process.env.OVERRIDE_AUTO_AWG?.toLowerCase();

    if (
      OVERRIDE_AUTO_AWG === ('wg' as const) ||
      OVERRIDE_AUTO_AWG === ('awg' as const)
    ) {
      return OVERRIDE_AUTO_AWG;
    } else {
      return await exec('modinfo amneziawg')
        .then(() => 'awg' as const)
        .catch(() => 'wg' as const);
    }
  } else return 'wg';
};

export const WG_ENV = {
  /** UI is hosted on HTTP instead of HTTPS */
  INSECURE: process.env.INSECURE === 'true',
  /** Port the UI is listening on */
  PORT: assertEnv('PORT'),
  /** If IPv6 should be disabled */
  DISABLE_IPV6: process.env.DISABLE_IPV6 === 'true',
  WG_EXECUTABLE: await detectAwg(),
};

export const WG_BUILD = {
  CHANNEL: process.env.WG_BUILD_CHANNEL || 'local',
  REVISION: process.env.WG_BUILD_REVISION || '',
  IMAGE_REPOSITORY:
    process.env.WG_IMAGE_REPOSITORY || 'ghcr.io/manawenuz/wg-easy-fork',
  UPDATE_REPO: process.env.WG_UPDATE_REPO || 'manawenuz/wg-easy',
  UPDATE_BRANCH: process.env.WG_UPDATE_BRANCH || 'master',
};

function readSshKey(): string | undefined {
  if (process.env.MIKROTIK_DEFAULT_SSH_KEY) {
    return process.env.MIKROTIK_DEFAULT_SSH_KEY;
  }
  if (process.env.MIKROTIK_DEFAULT_SSH_KEY_FILE) {
    try {
      return readFileSync(process.env.MIKROTIK_DEFAULT_SSH_KEY_FILE, 'utf8');
    } catch (err) {
      console.warn(
        '[config] Failed to read MIKROTIK_DEFAULT_SSH_KEY_FILE:',
        (err as Error).message
      );
    }
  }
  return undefined;
}

export const MIKROTIK_DEFAULT_ENV = {
  ENABLED: !!process.env.MIKROTIK_DEFAULT_HOST,
  NAME: process.env.MIKROTIK_DEFAULT_NAME || 'mikrotik-default',
  HOST: process.env.MIKROTIK_DEFAULT_HOST,
  TRANSPORT: (process.env.MIKROTIK_DEFAULT_TRANSPORT || 'ssh') as
    | 'ssh'
    | 'routeros-api',
  PORT: process.env.MIKROTIK_DEFAULT_PORT
    ? Number.parseInt(process.env.MIKROTIK_DEFAULT_PORT, 10)
    : undefined,
  API_PORT: process.env.MIKROTIK_DEFAULT_API_PORT
    ? Number.parseInt(process.env.MIKROTIK_DEFAULT_API_PORT, 10)
    : undefined,
  TLS_REQUIRED: process.env.MIKROTIK_DEFAULT_TLS_REQUIRED !== 'false',
  TLS_FINGERPRINT: process.env.MIKROTIK_DEFAULT_TLS_FINGERPRINT_SHA256,
  API_USER: process.env.MIKROTIK_DEFAULT_API_USER,
  API_PASSWORD: process.env.MIKROTIK_DEFAULT_API_PASSWORD,
  SSH_USER: process.env.MIKROTIK_DEFAULT_SSH_USER || 'wg-easy',
  SSH_KEY: readSshKey(),
  SSH_PASSPHRASE: process.env.MIKROTIK_DEFAULT_SSH_PASSPHRASE,
};

export const WG_INITIAL_ENV = {
  ENABLED: process.env.INIT_ENABLED === 'true',
  USERNAME: process.env.INIT_USERNAME,
  PASSWORD: process.env.INIT_PASSWORD,
  DNS: process.env.INIT_DNS?.split(',').map((x) => x.trim()),
  IPV4_CIDR: process.env.INIT_IPV4_CIDR,
  IPV6_CIDR: process.env.INIT_IPV6_CIDR,
  ALLOWED_IPS: process.env.INIT_ALLOWED_IPS?.split(',').map((x) => x.trim()),
  HOST: process.env.INIT_HOST,
  PORT: process.env.INIT_PORT
    ? Number.parseInt(process.env.INIT_PORT, 10)
    : undefined,
};

function assertEnv<T extends string>(env: T) {
  const val = process.env[env];

  if (!val) {
    throw new Error(`Missing environment variable: ${env}`);
  }

  return val;
}
