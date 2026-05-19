import z from 'zod';
import { logAction } from '../../../../utils/audit';
import { setSpeedLimit } from '../../../../services/speedLimitService';

const SpeedLimitPutSchema = z.object({
  upKbps: z.number().int().min(0),
  downKbps: z.number().int().min(0),
});

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'));
  if (!id || Number.isNaN(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid client ID',
    });
  }

  const body = await readValidatedBody(event, (data) =>
    SpeedLimitPutSchema.parse(data)
  );

  const client = await Database.clients.get(id);
  if (!client) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Client not found',
    });
  }
  await requireClientPermission(event, 'client:write', client);

  const result = await setSpeedLimit(id, body.upKbps, body.downKbps);

  await logAction(event, 'client.speedLimit.set', {
    clientId: id,
    upKbps: body.upKbps,
    downKbps: body.downKbps,
  });

  return result ?? { ok: true };
});
