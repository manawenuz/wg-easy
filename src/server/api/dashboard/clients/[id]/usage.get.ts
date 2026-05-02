import { z } from 'zod';

const UsageRangeSchema = z.object({
  range: z.enum(['24h', '7d', '30d']),
});

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'dashboard:self');

  const principal = event.context.principal!;

  if (principal.kind !== 'user') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
    });
  }

  const clientId = Number(getRouterParam(event, 'id'));

  if (Number.isNaN(clientId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid client ID',
    });
  }

  const client = await Database.clients.get(clientId);
  if (!client || client.userId !== principal.user.id) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Client not found',
    });
  }

  const { range } = await getValidatedQuery(
    event,
    validateZod(UsageRangeSchema, event)
  );

  const now = Date.now();
  const lookbackMs =
    range === '24h'
      ? 24 * 60 * 60 * 1000
      : range === '7d'
        ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
  const bucketMs =
    range === '24h'
      ? 5 * 60 * 1000
      : range === '7d'
        ? 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;

  const startTs = new Date(now - lookbackMs);

  const allSamples = await Database.usageSamples.getByClientId(clientId);
  const filteredSamples = allSamples.filter(
    (s) => s.ts && new Date(s.ts).getTime() >= startTs.getTime()
  );

  const buckets = new Map<
    number,
    { ts: number; rxBytes: number; txBytes: number }
  >();

  for (const sample of filteredSamples) {
    const tsMs = new Date(sample.ts).getTime();
    const bucketTs = Math.floor(tsMs / bucketMs) * bucketMs;
    const existing = buckets.get(bucketTs);
    if (existing) {
      existing.rxBytes += Number(sample.rxBytes);
      existing.txBytes += Number(sample.txBytes);
    } else {
      buckets.set(bucketTs, {
        ts: bucketTs,
        rxBytes: Number(sample.rxBytes),
        txBytes: Number(sample.txBytes),
      });
    }
  }

  const sortedBuckets = Array.from(buckets.values()).sort(
    (a, b) => a.ts - b.ts
  );

  return { buckets: sortedBuckets };
});
