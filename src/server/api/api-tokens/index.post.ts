import { randomBytes } from 'node:crypto';
import z from 'zod';

const CreateApiTokenSchema = z.object({
  label: z.string().optional(),
  scopes: z.array(z.string()).default([]),
  expiresAt: z.string().datetime().optional().nullable(),
});

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin:settings');

  const principal = event.context.principal!;
  const body = await readValidatedBody(event, (data) =>
    CreateApiTokenSchema.parse(data)
  );

  const tokenPlaintext = `wgep_${randomBytes(32).toString('base64url')}`;
  const tokenHash = await hashPassword(tokenPlaintext);

  const result = await Database.apiTokens.create({
    userId: principal.user.id,
    tokenHash,
    label: body.label,
    scopes: JSON.stringify(body.scopes),
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
  });

  if (!result) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to create token',
    });
  }

  return {
    id: result.id,
    token: tokenPlaintext,
  };
});
