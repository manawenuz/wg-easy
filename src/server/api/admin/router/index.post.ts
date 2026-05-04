import z from 'zod';
import { encrypt } from '../../../utils/crypto';
import type { EngineType } from '../../../engines/types';
import type { TransportType } from '../../../database/repositories/router/schema';

const CreateRouterSchema = z.object({
  name: z.string().min(1).pipe(safeStringRefine),
  engineType: z.enum(['wireguard', 'amneziawg', 'boringtun', 'mikrotik'] as const),
  transport: z.enum(['local-shell', 'ssh', 'routeros-api'] as const),
  host: z.string().min(1).optional().nullable(),
  port: z.number().int().min(1).max(65535).optional().nullable(),
  credentials: z.object({
    apiUser: z.string().min(1),
    apiPassword: z.string().min(1),
    sshUser: z.string().optional().nullable(),
    sshKey: z.string().optional().nullable(),
    sshPassphrase: z.string().optional().nullable(),
    tlsFingerprint: z.string().optional().nullable(),
  }),
  enabled: z.boolean().optional(),
});

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'router:admin');

  const body = await readValidatedBody(
    event,
    validateZod(CreateRouterSchema, event)
  );

  const credentials = {
    apiUser: body.credentials.apiUser,
    apiPassword: body.credentials.apiPassword,
    sshUser: body.credentials.sshUser ?? undefined,
    sshKey: body.credentials.sshKey ?? undefined,
    tlsFingerprint: body.credentials.tlsFingerprint ?? undefined,
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
    credentialsEncrypted: encrypt(JSON.stringify(credentials)),
    sshPassphraseEncrypted,
    enabled: body.enabled ?? true,
    lastSeen: null,
  });

  await logAction(event, 'router.create', { routerId: router.id, name: router.name });

  return {
    ...router,
    credentialsEncrypted: undefined,
  };
});
