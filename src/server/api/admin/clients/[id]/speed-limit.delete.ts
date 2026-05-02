import { logAction } from '../../../../utils/audit';
import { clearSpeedLimit } from '../../../../services/speedLimitService';

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'client:write');

  const id = Number(getRouterParam(event, 'id'));
  if (!id || Number.isNaN(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid client ID',
    });
  }

  const client = await Database.clients.get(id);
  if (!client) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Client not found',
    });
  }

  await clearSpeedLimit(id);

  await logAction(event, 'client.speedLimit.clear', { clientId: id });

  return { ok: true };
});
