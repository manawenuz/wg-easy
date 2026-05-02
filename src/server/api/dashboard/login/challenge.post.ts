import { createChallenge } from '../../../utils/wgKeyAuth';

export default defineEventHandler(async (event) => {
  const body = await readBody<{ publicKey?: string }>(event);

  if (!body || typeof body.publicKey !== 'string' || !body.publicKey.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'publicKey is required',
    });
  }

  const publicKey = body.publicKey.trim();

  return createChallenge(publicKey);
});
