import z from 'zod';
import { logAction } from '../../../../utils/audit';
import { quotaService } from '../../../../services/quotaService';

const QuotaPutSchema = z.object({
  limitBytes: z.number().int().positive(),
  period: z.enum(['daily', 'weekly', 'monthly']),
  autoDisable: z.boolean().optional(),
});

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin:settings');

  const id = Number(getRouterParam(event, 'id'));
  if (!id || Number.isNaN(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid client ID',
    });
  }

  const body = await readValidatedBody(event, (data) =>
    QuotaPutSchema.parse(data)
  );

  const client = await Database.clients.get(id);
  if (!client) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Client not found',
    });
  }

  await quotaService.setQuota(id, {
    limitBytes: body.limitBytes,
    period: body.period,
    autoDisable: body.autoDisable ?? true,
  });

  await logAction(event, 'quota.set', {
    clientId: id,
    limitBytes: body.limitBytes,
    period: body.period,
  });

  return { ok: true };
});
