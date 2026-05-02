import z from 'zod';
import { roles } from '#shared/utils/permissions';
import type { Role } from '#shared/utils/permissions';
import { logAction } from '../../../utils/audit';

const CreateUserSchema = z.object({
  username: z.string().min(2),
  password: z.string().min(12),
  role: z.number().refine((v) => Object.values(roles).includes(v as Role)),
  email: z.string().email().nullable().optional(),
});

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin:users');

  const body = await readValidatedBody(event, (data) =>
    CreateUserSchema.parse(data)
  );

  const result = await Database.users.createAdmin(
    body.username,
    body.password,
    body.role as Role,
    body.email
  );

  if (!result) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to create user',
    });
  }

  await logAction(event, 'user.create', {
    userId: result.id,
    username: body.username,
    role: body.role,
  });

  return { id: result.id };
});
