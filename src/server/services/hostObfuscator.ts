import { mkdirSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import debug from 'debug';

const HO_DEBUG = debug('HostObfuscator');
const execFile = promisify(execFileCb);

/**
 * Filesystem-backed config writer for the wg-obfuscator sidecar that runs
 * alongside wg-easy in docker-compose. wg-easy never spawns the container
 * itself — the operator declares the sidecar in compose. We just maintain
 * the per-interface config files in a shared volume the sidecar mounts.
 *
 * Default config dir: /etc/wireguard/obfuscator (mounted into the sidecar
 * at /etc/wg-obfuscator). Override with HOST_OBFUSCATOR_CONFIG_DIR.
 *
 * Reload: if HOST_OBFUSCATOR_RELOAD_CMD is set, run it after writing the
 * config so the sidecar picks up changes without a full restart. Suggested
 * value in compose: `docker kill -s HUP wg-obfuscator`. Best-effort —
 * failures are logged but do not fail the API call.
 */

const DEFAULT_CONFIG_DIR = '/etc/wireguard/obfuscator';

function configDir(): string {
  return process.env.HOST_OBFUSCATOR_CONFIG_DIR || DEFAULT_CONFIG_DIR;
}

function configPath(ifaceName: string): string {
  return join(configDir(), `${ifaceName}.conf`);
}

export interface HostObfuscatorConfig {
  ifaceName: string;
  listenPort: number;
  wgTargetHost: string;
  wgTargetPort: number;
  key: string;
  dummyPaddingMax?: number;
}

function renderConfig(cfg: HostObfuscatorConfig): string {
  const maxDummy = cfg.dummyPaddingMax ?? 64;
  return `# Managed by wg-easy. Do not edit by hand.
# Interface: ${cfg.ifaceName}
[main]
source-lport = ${cfg.listenPort}
target = ${cfg.wgTargetHost}:${cfg.wgTargetPort}
key = ${cfg.key}
verbose = 2
max-dummy = ${maxDummy}
`;
}

export async function writeConfig(cfg: HostObfuscatorConfig): Promise<void> {
  const dir = configDir();
  const path = configPath(cfg.ifaceName);

  // Atomic write: write to a sibling tmp file, then rename. Avoids the
  // sidecar reading a partial file mid-write.
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, renderConfig(cfg), { mode: 0o640 });
  renameSync(tmp, path);
  HO_DEBUG(`wrote ${path}`);

  await reloadSidecar();
}

export async function removeConfig(ifaceName: string): Promise<void> {
  const path = configPath(ifaceName);
  if (existsSync(path)) {
    unlinkSync(path);
    HO_DEBUG(`removed ${path}`);
    await reloadSidecar();
  }
}

async function reloadSidecar(): Promise<void> {
  const cmd = process.env.HOST_OBFUSCATOR_RELOAD_CMD;
  if (!cmd) return;
  // Split on whitespace; we don't accept shell metacharacters here so a
  // /bin/sh invocation isn't needed. Operators wanting fancy commands can
  // wrap them in their own shell script and point the env var at it.
  const parts = cmd.trim().split(/\s+/);
  const [bin, ...args] = parts;
  if (!bin) return;
  try {
    await execFile(bin, args, { timeout: 5000 });
    HO_DEBUG(`reload command "${cmd}" succeeded`);
  } catch (err) {
    // Reload is best-effort. The most common cause of failure is the
    // sidecar not running yet, which is the operator's responsibility.
    HO_DEBUG(`reload command "${cmd}" failed: ${(err as Error).message}`);
  }
}

export function clientObfuscatorConfig(opts: {
  endpoint: string;
  listenPort: number;
  key: string;
  clientLocalPort?: number;
}): string {
  const localPort = opts.clientLocalPort ?? 51830;
  return `# WireGuard Obfuscator client configuration
# Install wg-obfuscator from https://github.com/ClusterM/wg-obfuscator
# Run: wg-obfuscator --config /path/to/this/file.conf

[main]
source-lport = ${localPort}
target = ${opts.endpoint}:${opts.listenPort}
key = ${opts.key}
verbose = 2
`;
}
