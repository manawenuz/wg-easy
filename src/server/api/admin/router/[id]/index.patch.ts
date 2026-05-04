import z from 'zod';
import { encrypt } from '../../../../utils/crypto';
import type { EngineType } from '../../../../engines/types';
import type { TransportType } from '../../../../database/repositories/router/schema';

const UpdateRouterSchema = z.object({
  name: z.string().min(1).pipe(safeStringRefine).optional(),
  engineType: z.enum(['wireguard', 'amneziawg', 'boringtun', 'mikrotik'] as const).optional(),
  transport: z.enum(['local-shell', 'ssh', 'routeros-api'] as const).optional(),
  host: z.string().min(1).optional().nullable(),
  port: z.number().int().min(1).max(65535).optional().nullable(),
  credentials: z
    .object({
      apiUser: z.string().min(1),
      apiPassword: z.string().min(1),
      sshUser: z.string().optional().nullable(),
      sshKey: z.string().optional().nullable(),
      sshPassphrase: z.string().optional().nullable(),
      tlsFingerprint: z.string().optional().nullable(),
    })
    .optional(),
  enabled: z.boolean().optional(),
});

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'router:admin');

  const id = Number(getRouterParam(event, 'id'));
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid router ID' });
  }

  const body = await readValidatedBody(
    event,
    validateZod(UpdateRouterSchema, event)
  );

  const existing = await Database.routers.get(id);
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Router not found' });
  }

  const updateData: Parameters<typeof Database.routers.update>[1] = {};

  if (body.name !== undefined) updateData.name = body.name;
  if (body.engineType !== undefined) updateData.engineType = body.engineType as EngineType;
  if (body.transport !== undefined) updateData.transport = body.transport as TransportType;
  if (body.host !== undefined) updateData.host = body.host;
  if (body.port !== undefined) updateData.port = body.port;
  if (body.enabled !== undefined) updateData.enabled = body.enabled;

  if (body.credentials) {
    const credentials = {
      apiUser: body.credentials.apiUser,
      apiPassword: body.credentials.apiPassword,
      sshUser: body.credentials.sshUser ?? undefined,
      sshKey: body.credentials.sshKey ?? undefined,
      tlsFingerprint: body.credentials.tlsFingerprint ?? undefined,
    };
    updateData.credentialsEncrypted = encrypt(JSON.stringify(credentials));
    if (body.credentials.sshPassphrase) {
      updateData.sshPassphraseEncrypted = encrypt(body.credentials.sshPassphrase);
    }
  }

  const router = await Database.routers.update(id, updateData);

  await logAction(event, 'router.update', { routerId: id });

  return {
    ...router,
    credentialsEncrypted: undefined,
  };
});
