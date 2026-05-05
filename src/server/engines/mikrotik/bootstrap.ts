import { randomBytes } from 'node:crypto';
import { SshTransport } from '../../transports/ssh';
import { RouterOsSshTransport } from '../../transports/routeros-ssh';
import { decrypt, encrypt } from '../../utils/crypto';
import type { RouterType } from '#db/repositories/router/types';

export interface BootstrapOptions {
  ifaceName: string;
  listenPort: number;
  ipv4Cidr: string;
  ipv6Cidr?: string;
  wanInterface?: string;
  sshUser: string;
  sshPassword?: string;
  sshKey?: string;
}

export interface ProgressEvent {
  step: string;
  status: 'ok' | 'error' | 'pending';
  detail?: string;
  recovery?: string;
}

interface OkResult {
  ok: true;
  detail?: string;
}

interface ErrResult {
  ok: false;
  error: string;
  recovery: string;
}

type StepResult = OkResult | ErrResult;

function makeSshTransport(router: RouterType, opts: BootstrapOptions): SshTransport {
  const auth = opts.sshKey
    ? {
        type: 'key' as const,
        privateKey: opts.sshKey,
        ...(router.sshPassphraseEncrypted ? { passphrase: decrypt(router.sshPassphraseEncrypted) } : {}),
      }
    : { type: 'password' as const, password: opts.sshPassword ?? '' };

  return new SshTransport({
    host: router.host ?? 'localhost',
    port: router.port ?? 22,
    user: opts.sshUser,
    auth,
  });
}

function parseCount(stdout: string): number {
  const n = Number.parseInt(stdout.trim(), 10);
  return Number.isNaN(n) ? 0 : n;
}

function parseAsValue(stdout: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq).replace(/^\./, '');
      const value = trimmed.slice(eq + 1);
      result[key] = value;
    }
  }
  return result;
}

async function execAssert(ssh: SshTransport, cmd: string): Promise<string> {
  const { stdout, stderr, code } = await ssh.exec(cmd);
  if (code !== 0 && code !== null) {
    const err = stderr || stdout || `Command exited with code ${code}`;
    throw new Error(err);
  }
  return stdout;
}

async function stepConnect(ssh: SshTransport): Promise<StepResult> {
  try {
    await ssh.exec('/system/identity/print');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'SSH connection failed',
      recovery: 'Verify the router IP, SSH port, and credentials are correct.',
    };
  }
}

async function stepIdentity(ssh: SshTransport): Promise<StepResult> {
  try {
    const stdout = await execAssert(ssh, '/system/resource/print as-value');
    const values = parseAsValue(stdout);
    const version = values.version ?? 'unknown';
    const major = Number.parseInt(version.split('.')[0] ?? '0', 10);
    if (major < 7) {
      return {
        ok: false,
        error: `RouterOS ${version} detected. Only RouterOS 7.x is supported.`,
        recovery: 'Upgrade the router to RouterOS 7.x and retry.',
      };
    }
    return { ok: true, detail: version };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to read identity',
      recovery: 'Ensure the router is running and SSH service is enabled.',
    };
  }
}

async function stepWireguardInterface(
  ssh: SshTransport,
  opts: BootstrapOptions
): Promise<StepResult> {
  try {
    const exists = parseCount(
      await execAssert(ssh, `/interface/wireguard/print count-only where name="${opts.ifaceName}"`)
    );

    if (exists === 0) {
      await execAssert(
        ssh,
        `/interface/wireguard/add name="${opts.ifaceName}" listen-port=${opts.listenPort}`
      );
    } else {
      await execAssert(
        ssh,
        `/interface/wireguard/set [find name="${opts.ifaceName}"] listen-port=${opts.listenPort}`
      );
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to configure WireGuard interface',
      recovery: 'Check that RouterOS WireGuard package is installed and enabled.',
    };
  }
}

async function stepIpAddress(
  ssh: SshTransport,
  opts: BootstrapOptions
): Promise<StepResult> {
  try {
    const exists = parseCount(
      await execAssert(ssh, `/ip/address/print count-only where interface="${opts.ifaceName}"`)
    );

    if (exists === 0) {
      await execAssert(
        ssh,
        `/ip/address/add address="${opts.ipv4Cidr}" interface="${opts.ifaceName}" comment="wg-easy"`
      );
    }

    if (opts.ipv6Cidr) {
      const exists6 = parseCount(
        await execAssert(ssh, `/ipv6/address/print count-only where interface="${opts.ifaceName}"`)
      );
      if (exists6 === 0) {
        await execAssert(
          ssh,
          `/ipv6/address/add address="${opts.ipv6Cidr}" interface="${opts.ifaceName}" comment="wg-easy"`
        );
      }
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to assign IP address',
      recovery: 'Verify the CIDR is valid and does not conflict with existing addresses.',
    };
  }
}

async function detectWanInterface(ssh: SshTransport): Promise<string | undefined> {
  try {
    const stdout = await execAssert(ssh, '/ip/route/print as-value where dst-address=0.0.0.0/0');
    const values = parseAsValue(stdout);
    const gatewayStatus = values['gateway-status'];
    if (gatewayStatus) {
      const parts = gatewayStatus.split(',');
      if (parts.length > 1) return parts[1];
    }
    const iface = values.interface;
    if (iface) return iface;
    return undefined;
  } catch {
    return undefined;
  }
}

async function stepFirewall(
  ssh: SshTransport,
  opts: BootstrapOptions
): Promise<StepResult> {
  try {
    const exists = parseCount(
      await execAssert(
        ssh,
        '/ip/firewall/filter/print count-only where comment="wg-easy:input-allow"'
      )
    );

    if (exists === 0) {
      await execAssert(
        ssh,
        `/ip/firewall/filter/add chain=input protocol=udp dst-port=${opts.listenPort} action=accept comment="wg-easy:input-allow" place-before=0`
      );
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to add firewall rule',
      recovery: 'Run `/ip/firewall/filter print` and remove any conflicting rule, then retry.',
    };
  }
}

async function stepNat(
  ssh: SshTransport,
  opts: BootstrapOptions
): Promise<StepResult> {
  try {
    const exists = parseCount(
      await execAssert(
        ssh,
        '/ip/firewall/nat/print count-only where comment="wg-easy:masquerade"'
      )
    );

    if (exists === 0) {
      let wan = opts.wanInterface;
      if (!wan) {
        wan = await detectWanInterface(ssh);
      }
      if (!wan) {
        return {
          ok: false,
          error: 'Could not auto-detect WAN interface.',
          recovery: 'Specify the WAN interface explicitly in the bootstrap form and retry.',
        };
      }

      await execAssert(
        ssh,
        `/ip/firewall/nat/add chain=srcnat src-address="${opts.ipv4Cidr}" out-interface="${wan}" action=masquerade comment="wg-easy:masquerade"`
      );
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to add NAT rule',
      recovery: 'Run `/ip/firewall/nat print` and check for conflicts, then retry.',
    };
  }
}

async function stepApiUser(ssh: SshTransport): Promise<StepResult & { password?: string }> {
  try {
    const apiPassword = randomBytes(16).toString('hex');
    const exists = parseCount(
      await execAssert(ssh, '/user/print count-only where name="wgeasy"')
    );

    if (exists === 0) {
      await execAssert(
        ssh,
        `/user/add name="wgeasy" password="${apiPassword}" group="full" comment="wg-easy"`
      );
    } else {
      await execAssert(
        ssh,
        `/user/set [find name="wgeasy"] password="${apiPassword}" group="full"`
      );
    }

    return { ok: true, password: apiPassword };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to create API user',
      recovery: 'Ensure the current SSH user has write access to /user.',
    };
  }
}

async function stepApiSsl(ssh: SshTransport): Promise<StepResult> {
  try {
    // RouterOS exposes `disabled` (yes/no) on /ip/service items, not `enabled`.
    // Querying enabled=yes always returned 0 here, so we always entered the
    // setup branch and re-ran the enable command.
    const alreadyEnabled = parseCount(
      await execAssert(ssh, '/ip/service/print count-only where name="api-ssl" and disabled=no')
    );

    // Ensure a self-signed cert exists named api-ssl-cert and is signed.
    // Idempotent: re-running on a router with a valid cert is a no-op.
    const certCount = parseCount(
      await execAssert(ssh, '/certificate/print count-only where name="api-ssl-cert"')
    );
    if (certCount === 0) {
      await execAssert(
        ssh,
        '/certificate/add name=api-ssl-cert common-name=RouterOS key-usage=key-cert-sign,crl-sign'
      );
      await execAssert(ssh, '/certificate/sign api-ssl-cert');
      // Add a server-auth cert signed by the CA. Some ROS 7.x require a
      // separate end-entity cert with key-usage=tls-server for api-ssl.
      const hasServer = parseCount(
        await execAssert(ssh, '/certificate/print count-only where name="api-ssl-server"')
      );
      if (hasServer === 0) {
        await execAssert(
          ssh,
          '/certificate/add name=api-ssl-server common-name=api-ssl-server key-usage=tls-server'
        );
        // sign with our self-signed CA when possible; if it fails (older ROS),
        // self-sign as fallback so api-ssl still has a usable cert.
        try {
          await execAssert(ssh, '/certificate/sign api-ssl-server ca=api-ssl-cert');
        } catch {
          await execAssert(ssh, '/certificate/sign api-ssl-server');
        }
      }
    }

    // Set the cert and disabled flag separately. Some ROS versions reject
    // multiple property=value pairs in a single set call for /ip/service.
    // Prefer the leaf (api-ssl-server) cert; fall back to api-ssl-cert.
    const useCert = parseCount(
      await execAssert(ssh, '/certificate/print count-only where name="api-ssl-server"')
    ) > 0
      ? 'api-ssl-server'
      : 'api-ssl-cert';

    await execAssert(ssh, `/ip/service/set [find name=api-ssl] certificate=${useCert}`);
    if (alreadyEnabled === 0) {
      await execAssert(ssh, '/ip/service/set [find name=api-ssl] disabled=no');
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to enable API-SSL',
      recovery:
        'Run on the router: /certificate/add name=api-ssl-cert common-name=RouterOS key-usage=key-cert-sign,crl-sign; /certificate/sign api-ssl-cert; /ip/service/set [find name=api-ssl] certificate=api-ssl-cert disabled=no',
    };
  }
}

async function stepCaptureFingerprint(ssh: SshTransport): Promise<StepResult & { fingerprint?: string }> {
  try {
    const stdout = await execAssert(ssh, '/certificate/print as-value where name~"api-ssl-cert"');
    const values = parseAsValue(stdout);
    const fp = values.fingerprint || values['sha256-fingerprint'] || values.digest;
    return { ok: true, fingerprint: fp };
  } catch {
    return { ok: true };
  }
}

async function stepTestApi(
  router: RouterType,
  ssh: SshTransport
): Promise<StepResult> {
  try {
    const api = new RouterOsSshTransport(ssh);
    const peers = await api.print('/interface/wireguard/peers');
    return { ok: true, detail: `${peers.length} peers` };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'SSH command test failed',
      recovery: 'Verify the SSH user has sufficient permissions to print WireGuard peers.',
    };
  }
}

export async function bootstrap(
  router: RouterType,
  opts: BootstrapOptions,
  emit: (e: ProgressEvent) => void
): Promise<void> {
  const ssh = makeSshTransport(router, opts);

  const steps: Array<{ name: string; fn: () => Promise<StepResult & { password?: string; fingerprint?: string }> }> = [
    { name: 'connect', fn: () => stepConnect(ssh) },
    { name: 'identity', fn: () => stepIdentity(ssh) },
    { name: 'wireguard-interface', fn: () => stepWireguardInterface(ssh, opts) },
    { name: 'ip-address', fn: () => stepIpAddress(ssh, opts) },
    { name: 'firewall', fn: () => stepFirewall(ssh, opts) },
    { name: 'nat', fn: () => stepNat(ssh, opts) },
    { name: 'api-user', fn: () => stepApiUser(ssh) },
    { name: 'api-ssl', fn: () => stepApiSsl(ssh) },
    { name: 'fingerprint', fn: () => stepCaptureFingerprint(ssh) },
  ];

  let apiPassword: string | undefined;
  let tlsFingerprint: string | undefined;

  for (const step of steps) {
    emit({ step: step.name, status: 'pending' });
    const result = await step.fn();
    if (result.password) {
      apiPassword = result.password;
    }
    if (result.fingerprint) {
      tlsFingerprint = result.fingerprint;
    }

    if (result.ok) {
      emit({ step: step.name, status: 'ok', detail: result.detail });
    } else {
      emit({ step: step.name, status: 'error', detail: result.error, recovery: result.recovery });
      await ssh.close();
      return;
    }
  }

  // Step 10: persist credentials and switch transport
  emit({ step: 'persist', status: 'pending' });
  try {
    const credentials = {
      apiUser: 'wgeasy',
      apiPassword: apiPassword ?? randomBytes(16).toString('hex'),
      sshUser: opts.sshUser,
      sshKey: opts.sshKey ? Buffer.from(opts.sshKey).toString('base64') : undefined,
      tlsFingerprint: tlsFingerprint,
    };

    await Database.routers.update(router.id, {
      transport: 'routeros-ssh',
      port: router.port ?? 22,
      credentialsEncrypted: encrypt(JSON.stringify(credentials)),
    });

    emit({ step: 'persist', status: 'ok' });
  } catch (err) {
    emit({
      step: 'persist',
      status: 'error',
      detail: err instanceof Error ? err.message : 'Failed to persist credentials',
      recovery: 'Check database connectivity and retry.',
    });
    await ssh.close();
    return;
  }

  // Step 11: test SSH connection via RouterOsSshTransport
  emit({ step: 'test-api', status: 'pending' });
  
  const testResult = await stepTestApi(router, ssh);
  if (testResult.ok) {
    emit({ step: 'test-api', status: 'ok', detail: testResult.detail });
  } else {
    emit({
      step: 'test-api',
      status: 'error',
      detail: testResult.error,
      recovery: testResult.recovery,
    });
    await ssh.close();
    return;
  }

  // Step 12: bind the active wg-easy interface to this router so subsequent
  // peer mutations land on the MikroTik instead of the local 'self' engine.
  // Without this step, bootstrap leaves the router registered but inactive,
  // and clients keep going to the local kernel WG. Skipped silently if the
  // single-interface model isn't present.
  emit({ step: 'activate', status: 'pending' });
  try {
    const iface = await Database.interfaces.get().catch(() => null);
    if (iface) {
      await Database.interfaces.update({
        engineType: 'mikrotik',
        port: opts.listenPort,
        ipv4Cidr: opts.ipv4Cidr,
        ipv6Cidr: opts.ipv6Cidr ?? iface.ipv6Cidr,
        routerId: router.id,
      } as Parameters<typeof Database.interfaces.update>[0]);
      emit({ step: 'activate', status: 'ok', detail: `Bound interface to router #${router.id}` });
    } else {
      emit({ step: 'activate', status: 'ok', detail: 'No active interface to bind; router is registered.' });
    }
  } catch (err) {
    emit({
      step: 'activate',
      status: 'error',
      detail: err instanceof Error ? err.message : 'Failed to bind interface',
      recovery: 'You can bind the interface manually via Routers → Activate.',
    });
  }

  await ssh.close();
  emit({ step: 'done', status: 'ok' });
}
