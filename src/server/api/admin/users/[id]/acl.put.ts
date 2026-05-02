import z from 'zod';
import { logAction } from '../../../../utils/audit';

const AclPutSchema = z.array(
  z.object({
    routerId: z.number(),
    permission: z.enum(['read', 'write', 'admin']),
  })
);

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin:users');

  const id = Number(getRouterParam(event, 'id'));
  if (!id || Number.isNaN(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid user ID',
    });
  }

  const body = await readValidatedBody(event, (data) =>
    AclPutSchema.parse(data)
  );

  await Database.adminRouterAcls.replaceForUser(
    id,
    body.map((b) => ({ routerId: b.routerId, permission: b.permission }))
  );

  await logAction(event, 'user.acl.update', { userId: id, count: body.length });

  return { ok: true };
});
