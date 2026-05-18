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
      statusMessage: 'Invalid user ID',
    });
  }

  const user = await Database.users.get(id);
  if (!user) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User not found',
    });
  }

  if (user.parentUserId !== null) {
    const rootId = await Database.users.getRootUserId(id);
    throw createError({
      statusCode: 409,
      statusMessage: `quota_inherited`,
      data: { rootUserId: rootId },
    });
  }

  const body = await readValidatedBody(event, (data) =>
    QuotaPutSchema.parse(data)
  );

  await quotaService.setForUser(id, {
    limitBytes: body.limitBytes,
    period: body.period,
    autoDisable: body.autoDisable ?? true,
  });

  await logAction(event, 'quota.set', {
    userId: id,
    limitBytes: body.limitBytes,
    period: body.period,
  });

  return { ok: true };
});
