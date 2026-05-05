import z from 'zod';
import { getServerFingerprint } from '../../../transports/tls-pin';

const FingerprintSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).optional().default(8729),
});

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'router:admin');

  const body = await readValidatedBody(
    event,
    validateZod(FingerprintSchema, event)
  );

  try {
    const result = await getServerFingerprint(body.host, body.port);
    return {
      ok: true,
      ...result,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw createError({
      statusCode: 502,
      statusMessage: `Failed to fetch fingerprint: ${message}`,
    });
  }
});
