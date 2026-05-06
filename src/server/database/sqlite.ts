import { drizzle } from 'drizzle-orm/libsql';
import { migrate as drizzleMigrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import debug from 'debug';
import { eq } from 'drizzle-orm';
import { roles } from '#shared/utils/permissions';
import { encrypt } from '../utils/crypto';
import { MIKROTIK_DEFAULT_ENV } from '../utils/config';

import * as schema from './schema';
import { ClientService } from './repositories/client/service';
import { GeneralService } from './repositories/general/service';
import { UserService } from './repositories/user/service';
import { UserConfigService } from './repositories/userConfig/service';
import { InterfaceService } from './repositories/interface/service';
import { HooksService } from './repositories/hooks/service';
import { OneTimeLinkService } from './repositories/oneTimeLink/service';
import { RouterService } from './repositories/router/service';
import { QuotaService } from './repositories/quota/service';
import { SpeedLimitService } from './repositories/speedLimit/service';
import { UsageSampleService } from './repositories/usageSample/service';
import { AuditLogService } from './repositories/auditLog/service';
import { AdminRouterAclService } from './repositories/adminRouterAcl/service';
import { ExitNodeService } from './repositories/exitNode/service';
import { RoutePolicyService } from './repositories/routePolicy/service';
import { ApiTokenService } from './repositories/apiToken/service';
import { WgObfuscatorConfigService } from './repositories/wgObfuscatorConfig/service';
import { PendingMutationService } from './repositories/pendingMutation/service';
import { TrafficGroupService } from './repositories/trafficGroup/service';

const DB_DEBUG = debug('Database');

const client = createClient({ url: process.env.DATABASE_URL || 'file:/etc/wireguard/wg-easy.db' });
const db = drizzle({ client, schema });

export async function connect() {
  await migrate();
  const dbService = new DBService(db);

  await promoteSingleAdminToSuperadmin(dbService);
  await migrateAwgEngineType(dbService);

  if (WG_INITIAL_ENV.ENABLED) {
    await initialSetup(dbService);
  }

  await seedDefaultMikrotikRouter(dbService);

  if (WG_ENV.DISABLE_IPV6) {
    DB_DEBUG('Warning: Disabling IPv6...');
    await disableIpv6(db);
  }

  return dbService;
}

class DBService {
  clients: ClientService;
  general: GeneralService;
  users: UserService;
  userConfigs: UserConfigService;
  interfaces: InterfaceService;
  hooks: HooksService;
  oneTimeLinks: OneTimeLinkService;
  routers: RouterService;
  quotas: QuotaService;
  speedLimits: SpeedLimitService;
  usageSamples: UsageSampleService;
  auditLogs: AuditLogService;
  adminRouterAcls: AdminRouterAclService;
  exitNodes: ExitNodeService;
  routePolicies: RoutePolicyService;
  apiTokens: ApiTokenService;
  wgObfuscatorConfigs: WgObfuscatorConfigService;
  pendingMutations: PendingMutationService;
  trafficGroups: TrafficGroupService;

  constructor(db: DBType) {
    this.clients = new ClientService(db);
    this.general = new GeneralService(db);
    this.users = new UserService(db);
    this.userConfigs = new UserConfigService(db);
    this.interfaces = new InterfaceService(db);
    this.hooks = new HooksService(db);
    this.oneTimeLinks = new OneTimeLinkService(db);
    this.routers = new RouterService(db);
    this.quotas = new QuotaService(db);
    this.speedLimits = new SpeedLimitService(db);
    this.usageSamples = new UsageSampleService(db);
    this.auditLogs = new AuditLogService(db);
    this.adminRouterAcls = new AdminRouterAclService(db);
    this.exitNodes = new ExitNodeService(db);
    this.routePolicies = new RoutePolicyService(db);
    this.apiTokens = new ApiTokenService(db);
    this.wgObfuscatorConfigs = new WgObfuscatorConfigService(db);
    this.pendingMutations = new PendingMutationService(db);
    this.trafficGroups = new TrafficGroupService(db);
  }
}

export type DBType = typeof db;
export type DBServiceType = DBService;

async function migrate() {
  try {
    DB_DEBUG('Migrating database...');
    await drizzleMigrate(db, {
      migrationsFolder: './server/database/migrations',
    });
    DB_DEBUG('Migration complete');
  } catch (e) {
    if (e instanceof Error) {
      DB_DEBUG('Failed to migrate database:', e.message);
    }
  }
}

async function initialSetup(db: DBServiceType) {
  const setup = await db.general.getSetupStep();

  if (setup.done) {
    DB_DEBUG('Setup already done. Skiping initial setup.');
    return;
  }

  if (WG_INITIAL_ENV.IPV4_CIDR && WG_INITIAL_ENV.IPV6_CIDR) {
    DB_DEBUG('Setting initial CIDR...');
    await db.interfaces.updateCidr({
      ipv4Cidr: WG_INITIAL_ENV.IPV4_CIDR,
      ipv6Cidr: WG_INITIAL_ENV.IPV6_CIDR,
    });
  }

  if (WG_INITIAL_ENV.DNS) {
    DB_DEBUG('Setting initial DNS...');
    await db.userConfigs.update({
      defaultDns: WG_INITIAL_ENV.DNS,
    });
  }

  if (WG_INITIAL_ENV.ALLOWED_IPS) {
    DB_DEBUG('Setting initial Allowed IPs...');
    await db.userConfigs.update({
      defaultAllowedIps: WG_INITIAL_ENV.ALLOWED_IPS,
    });
  }

  if (
    WG_INITIAL_ENV.USERNAME &&
    WG_INITIAL_ENV.PASSWORD &&
    WG_INITIAL_ENV.HOST &&
    WG_INITIAL_ENV.PORT
  ) {
    DB_DEBUG('Creating initial user...');
    await db.users.create(WG_INITIAL_ENV.USERNAME, WG_INITIAL_ENV.PASSWORD);

    DB_DEBUG('Setting initial host and port...');
    await db.userConfigs.updateHostPort(
      WG_INITIAL_ENV.HOST,
      WG_INITIAL_ENV.PORT
    );

    await db.general.setSetupStep(0);
  }
}

async function seedDefaultMikrotikRouter(db: DBServiceType) {
  if (!MIKROTIK_DEFAULT_ENV.ENABLED || !MIKROTIK_DEFAULT_ENV.HOST) return;

  const existing = await db.routers.getAll();
  if (existing.some((r) => r.name === MIKROTIK_DEFAULT_ENV.NAME)) {
    DB_DEBUG(`Default MikroTik router '${MIKROTIK_DEFAULT_ENV.NAME}' already present, skipping seed.`);
    return;
  }

  const transport = MIKROTIK_DEFAULT_ENV.TRANSPORT;
  const isSsh = transport === 'ssh';
  const port = MIKROTIK_DEFAULT_ENV.PORT ?? (isSsh ? 22 : null);
  const apiPort =
    MIKROTIK_DEFAULT_ENV.API_PORT ?? (MIKROTIK_DEFAULT_ENV.TLS_REQUIRED ? 8729 : 8728);

  const sshKeyB64 = MIKROTIK_DEFAULT_ENV.SSH_KEY
    ? Buffer.from(MIKROTIK_DEFAULT_ENV.SSH_KEY, 'utf8').toString('base64')
    : undefined;

  const credentials = {
    apiUser: MIKROTIK_DEFAULT_ENV.API_USER,
    apiPassword: MIKROTIK_DEFAULT_ENV.API_PASSWORD,
    sshUser: isSsh ? MIKROTIK_DEFAULT_ENV.SSH_USER : undefined,
    sshKey: isSsh ? sshKeyB64 : undefined,
  };

  // Validate the credential set matches the chosen transport so we fail fast
  // with a clear log line instead of letting the engine error later.
  if (!isSsh && (!credentials.apiUser || !credentials.apiPassword)) {
    console.warn(
      '[seed] MIKROTIK_DEFAULT_TRANSPORT=routeros-api requires MIKROTIK_DEFAULT_API_USER and MIKROTIK_DEFAULT_API_PASSWORD; skipping seed.'
    );
    return;
  }
  if (isSsh && !credentials.sshKey && !credentials.apiPassword) {
    console.warn(
      '[seed] MIKROTIK_DEFAULT_TRANSPORT=ssh requires either MIKROTIK_DEFAULT_SSH_KEY(_FILE) or MIKROTIK_DEFAULT_API_PASSWORD; skipping seed.'
    );
    return;
  }

  DB_DEBUG(`Seeding default MikroTik router '${MIKROTIK_DEFAULT_ENV.NAME}' at ${MIKROTIK_DEFAULT_ENV.HOST} via ${transport}`);

  const sshPassphraseEncrypted = MIKROTIK_DEFAULT_ENV.SSH_PASSPHRASE
    ? encrypt(MIKROTIK_DEFAULT_ENV.SSH_PASSPHRASE)
    : null;

  await db.routers.create({
    name: MIKROTIK_DEFAULT_ENV.NAME,
    engineType: 'mikrotik',
    transport,
    host: MIKROTIK_DEFAULT_ENV.HOST,
    port,
    apiPort,
    tlsRequired: MIKROTIK_DEFAULT_ENV.TLS_REQUIRED,
    tlsFingerprintSha256: MIKROTIK_DEFAULT_ENV.TLS_FINGERPRINT ?? null,
    credentialsEncrypted: encrypt(JSON.stringify(credentials)),
    sshPassphraseEncrypted,
    enabled: true,
    lastSeen: null,
  });
}

async function migrateAwgEngineType(db: DBServiceType) {
  /** TODO: delete on next major version */
  if (WG_ENV.WG_EXECUTABLE === 'awg') {
    const iface = await db.interfaces.get().catch(() => null);
    if (iface && iface.engineType === 'wireguard') {
      DB_DEBUG('Migrating interface from wireguard to amneziawg engine...');
      await db.interfaces.update({ engineType: 'amneziawg' });
      DB_DEBUG('Migration complete');
    }
  }
}

async function promoteSingleAdminToSuperadmin(db: DBServiceType) {
  const allUsers = await db.users.getAll();
  const adminUsers = allUsers.filter((u) => u.role === roles.ADMIN);

  if (adminUsers.length === 1) {
    DB_DEBUG('Promoting single admin to superadmin...');
    await db.users.updateRole(adminUsers[0]!.id, roles.SUPERADMIN);
  }
}

async function disableIpv6(db: DBType) {
  // This should match the initial value migration
  const postUpMatch =
    ' ip6tables -t nat -A POSTROUTING -s {{ipv6Cidr}} -o {{device}} -j MASQUERADE; ip6tables -A INPUT -p udp -m udp --dport {{port}} -j ACCEPT; ip6tables -A FORWARD -i wg0 -j ACCEPT; ip6tables -A FORWARD -o wg0 -j ACCEPT;';
  const postDownMatch =
    ' ip6tables -t nat -D POSTROUTING -s {{ipv6Cidr}} -o {{device}} -j MASQUERADE; ip6tables -D INPUT -p udp -m udp --dport {{port}} -j ACCEPT; ip6tables -D FORWARD -i wg0 -j ACCEPT; ip6tables -D FORWARD -o wg0 -j ACCEPT;';

  await db.transaction(async (tx) => {
    const hooks = await tx.query.hooks.findFirst({
      where: eq(schema.hooks.id, 'wg0'),
    });

    if (!hooks) {
      throw new Error('Hooks not found');
    }

    if (hooks.postUp.includes(postUpMatch)) {
      DB_DEBUG('Disabling IPv6 in Post Up hooks...');
      await tx
        .update(schema.hooks)
        .set({
          postUp: hooks.postUp.replace(postUpMatch, ''),
          postDown: hooks.postDown.replace(postDownMatch, ''),
        })
        .where(eq(schema.hooks.id, 'wg0'))
        .execute();
    } else {
      DB_DEBUG('IPv6 Post Up hooks already disabled, skipping...');
    }
    if (hooks.postDown.includes(postDownMatch)) {
      DB_DEBUG('Disabling IPv6 in Post Down hooks...');
      await tx
        .update(schema.hooks)
        .set({
          postUp: hooks.postUp.replace(postUpMatch, ''),
          postDown: hooks.postDown.replace(postDownMatch, ''),
        })
        .where(eq(schema.hooks.id, 'wg0'))
        .execute();
    } else {
      DB_DEBUG('IPv6 Post Down hooks already disabled, skipping...');
    }
  });
}
