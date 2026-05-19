import z from 'zod';
import { encrypt } from '../../../utils/crypto';
import type { EngineType } from '../../../engines/types';
import type { TransportType } from '../../../database/repositories/router/schema';

const CreateRouterSchema = z
  .object({
    name: z.string().min(1).pipe(safeStringRefine),
    engineType: z.enum([
      'wireguard',
      'amneziawg',
      'boringtun',
      'mikrotik',
    ] as const),
    transport: z.enum(['local-shell', 'ssh', 'routeros-api'] as const),
    host: z.string().min(1).optional().nullable(),
    port: z.number().int().min(1).max(65535).optional().nullable(),
    apiPort: z.number().int().min(1).max(65535).optional().nullable(),
    tlsRequired: z.boolean().optional(),
    tlsFingerprintSha256: z.string().optional().nullable(),
    credentials: z.object({
      apiUser: z.string().optional().nullable(),
      apiPassword: z.string().optional().nullable(),
      sshUser: z.string().optional().nullable(),
      sshKey: z.string().optional().nullable(),
      sshPassphrase: z.string().optional().nullable(),
    }),
    enabled: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.transport === 'routeros-api') {
      if (!val.credentials.apiUser || !val.credentials.apiPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'apiUser and apiPassword are required for routeros-api transport',
          path: ['credentials'],
        });
      }
    } else if (val.transport === 'ssh') {
      if (!val.credentials.sshUser) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'sshUser is required for ssh transport',
          path: ['credentials', 'sshUser'],
        });
      }
      if (!val.credentials.sshKey && !val.credentials.apiPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'either sshKey or apiPassword is required for ssh transport',
          path: ['credentials', 'sshKey'],
        });
      }
    }
  });

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'router:admin');

  const body = await readValidatedBody(
    event,
    validateZod(CreateRouterSchema, event)
  );

  const credentials = {
    apiUser: body.credentials.apiUser ?? undefined,
    apiPassword: body.credentials.apiPassword ?? undefined,
    sshUser: body.credentials.sshUser ?? undefined,
    sshKey: body.credentials.sshKey ?? undefined,
  };

  const sshPassphraseEncrypted = body.credentials.sshPassphrase
    ? encrypt(body.credentials.sshPassphrase)
    : null;

  const router = await Database.routers.create({
    name: body.name,
    engineType: body.engineType as EngineType,
    transport: body.transport as TransportType,
    host: body.host ?? null,
    port: body.port ?? null,
    apiPort: body.apiPort ?? 8729,
    tlsRequired: body.tlsRequired ?? true,
    tlsFingerprintSha256: body.tlsFingerprintSha256 ?? null,
    credentialsEncrypted: encrypt(JSON.stringify(credentials)),
    sshPassphraseEncrypted,
    enabled: body.enabled ?? true,
    lastSeen: null,
    lastSeenOkAt: null,
    lastSeenError: null,
    consecutiveFailures: 0,
  });

  await logAction(event, 'router.create', {
    routerId: router.id,
    name: router.name,
  });

  return {
    ...router,
    credentialsEncrypted: undefined,
  };
});
