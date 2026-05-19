import { z } from 'zod';

const UsageRangeSchema = z.object({
  range: z.enum(['24h', '7d', '30d']),
});

export default defineEventHandler(async (event) => {
  const allowedRouterIds = await getAllowedRouterIds(event, 'client:read');

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

  const allSamples = await Database.usageSamples.getAll();
  let allowedClientIds: Set<number> | null = null;
  if (allowedRouterIds !== null) {
    const interfaces = await Database.interfaces.getAll();
    const routerIdByInterface = new Map(
      interfaces.map((iface) => [iface.name, iface.routerId])
    );
    allowedClientIds = new Set(
      (await Database.clients.getAllPublic())
        .filter((client) => {
          const routerId = routerIdByInterface.get(client.interfaceId);
          return routerId !== undefined && allowedRouterIds.has(routerId);
        })
        .map((client) => client.id)
    );
  }
  const filteredSamples = allSamples
    .filter(
      (sample) =>
        allowedClientIds === null || allowedClientIds.has(sample.clientId)
    )
    .filter((s) => s.ts && new Date(s.ts).getTime() >= startTs.getTime())
    .sort((a, b) => {
      const tsDiff = new Date(a.ts).getTime() - new Date(b.ts).getTime();
      if (tsDiff !== 0) return tsDiff;
      return a.clientId - b.clientId;
    });

  // Compute deltas per client, then aggregate into buckets
  const deltas: { ts: number; rxBytes: number; txBytes: number }[] = [];

  // Group samples by client
  const samplesByClient = new Map<number, typeof filteredSamples>();
  for (const sample of filteredSamples) {
    const arr = samplesByClient.get(sample.clientId);
    if (arr) {
      arr.push(sample);
    } else {
      samplesByClient.set(sample.clientId, [sample]);
    }
  }

  for (const [, samples] of samplesByClient) {
    for (let i = 1; i < samples.length; i++) {
      const curr = samples[i]!;
      const prev = samples[i - 1]!;
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
