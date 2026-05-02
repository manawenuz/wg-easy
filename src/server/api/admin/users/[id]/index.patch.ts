import z from 'zod';
import { roles } from '#shared/utils/permissions';
import type { Role } from '#shared/utils/permissions';
import { logAction } from '../../../../utils/audit';

const PatchUserSchema = z.object({
  role: z
    .number()
    .refine((v) => Object.values(roles).includes(v as Role))
    .optional(),
  enabled: z.boolean().optional(),
  email: z.string().email().nullable().optional(),
  password: z.string().min(12).optional(),
});

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin:users');

  const id = Number(getRouterParam(event, 'id'));
  if (!id || Number.isNaN(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid user ID',
    });
  }

  const principal = event.context.principal!;

  // Cannot demote self if last superadmin
  if (id === principal.user.id) {
    const allUsers = await Database.users.getAll();
    const superadmins = allUsers.filter((u) => u.role === roles.SUPERADMIN);
    if (superadmins.length <= 1) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Cannot modify the last superadmin',
      });
    }
  }

  const body = await readValidatedBody(event, (data) =>
    PatchUserSchema.parse(data)
  );

  if (body.role !== undefined) {
    await Database.users.updateRole(id, body.role as Role);
  }
  if (body.enabled !== undefined) {
    await Database.users.updateEnabled(id, body.enabled);
  }
  if (body.email !== undefined) {
    await Database.users.updateEmail(id, body.email);
  }
  if (body.password) {
    await Database.users.updatePasswordDirect(id, body.password);
  }

  await logAction(event, 'user.update', { userId: id, changes: Object.keys(body) });

  return { ok: true };
});
