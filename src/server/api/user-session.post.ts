import { eq } from 'drizzle-orm';
import { client } from '#db/schema';

export default defineEventHandler(async (event) => {
  const body = await readBody<{ publicKey?: string }>(event);

  if (!body) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Body is required',
    });
  }

  // Placeholder: full challenge/signature verification ships in QR/key PRD
  const { publicKey } = body;

  if (!publicKey || typeof publicKey !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'publicKey is required',
    });
  }

  const clientRecord = await Database.clients.getAll().then((clients) =>
    clients.find((c) => c.publicKey === publicKey)
  );

  if (!clientRecord) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid public key',
    });
  }

  const user = await Database.users.get(clientRecord.userId);

  if (!user || !user.enabled) {
    throw createError({
      statusCode: 403,
      statusMessage: 'User disabled',
    });
  }

  const session = await useWGUserSession(event);
  await session.update({ userId: user.id });

  return { status: 'success' };
});
