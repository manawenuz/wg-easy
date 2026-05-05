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

  const clientId = Number(getRouterParam(event, 'clientId'));

  if (Number.isNaN(clientId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid client ID',
    });
  }

  const client = await Database.clients.get(clientId);
  if (!client || client.userId !== principal.dashboardUserId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
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
  const filteredSamples = allSamples
    .filter((s) => s.ts && new Date(s.ts).getTime() >= startTs.getTime())
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  // Compute deltas from cumulative counters
  const deltas: { ts: number; rxBytes: number; txBytes: number }[] = [];
  for (let i = 1; i < filteredSamples.length; i++) {
    const curr = filteredSamples[i]!;
    const prev = filteredSamples[i - 1]!;
    const rxDelta = Math.max(0, Number(curr.rxBytes) - Number(prev.rxBytes));
    const txDelta = Math.max(0, Number(curr.txBytes) - Number(prev.txBytes));
    if (rxDelta > 0 || txDelta > 0) {
      deltas.push({
        ts: new Date(curr.ts).getTime(),
        rxBytes: rxDelta,
        txBytes: txDelta,
      });
    }
  }

  // Bucket the deltas
  const buckets = new Map<
    number,
    { ts: number; rxBytes: number; txBytes: number }
  >();

  for (const delta of deltas) {
    const bucketTs = Math.floor(delta.ts / bucketMs) * bucketMs;
    const existing = buckets.get(bucketTs);
    if (existing) {
      existing.rxBytes += delta.rxBytes;
      existing.txBytes += delta.txBytes;
    } else {
      buckets.set(bucketTs, {
        ts: bucketTs,
        rxBytes: delta.rxBytes,
        txBytes: delta.txBytes,
      });
    }
  }

  const sortedBuckets = Array.from(buckets.values()).sort(
    (a, b) => a.ts - b.ts
  );

  return { buckets: sortedBuckets };
});
