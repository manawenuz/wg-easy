import { getRequestIP } from 'h3';
import { verifyChallenge, isRateLimited, recordAttempt } from '../../../utils/wgKeyAuth';

export default defineEventHandler(async (event) => {
  const body = await readBody<{ challengeId?: string; signature?: string }>(event);

  if (!body || typeof body.challengeId !== 'string' || typeof body.signature !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'challengeId and signature are required',
    });
  }

  const ip = getRequestIP(event) || 'unknown';
  if (isRateLimited(ip)) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Too many attempts',
    });
  }
  recordAttempt(ip);

  const publicKey = verifyChallenge(body.challengeId, body.signature);
  if (!publicKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid challenge or signature',
    });
  }

  const clientRecord = await Database.clients.findByPublicKey(publicKey);

  if (!clientRecord) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid public key',
    });
  }

  // Allow disabled clients to log in so they can view their activity/quota.
  // Only block if the client has expired.
  if (clientRecord.expiresAt && new Date(clientRecord.expiresAt) < new Date()) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Client has expired',
    });
  }

  const user = clientRecord.user;

  if (!user || !user.enabled) {
    throw createError({
      statusCode: 403,
      statusMessage: 'User is disabled',
    });
  }

  // Accept any user role for dashboard login — if they have a valid
  // WireGuard client config they should be able to see their stats.

  const sessionConfig = await Database.general.getSessionConfig();
  const session = await useSession<WGSession>(event, {
    password: sessionConfig.sessionPassword,
    name: 'wg-user-session',
    cookie: {
      maxAge: 60 * 60 * 24 * 30,
      secure: !WG_ENV.INSECURE,
    },
  });
  await session.update({ userId: user.id, clientId: clientRecord.id });

  return { ok: true };
});
