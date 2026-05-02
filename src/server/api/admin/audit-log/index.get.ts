import { z } from 'zod';

const QuerySchema = z.object({
  actor: z.string().optional(),
  action: z.string().optional(),
  target: z.string().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.string().transform(Number).optional(),
  offset: z.string().transform(Number).optional(),
});

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin:settings');

  const query = getQuery(event);
  const parsed = QuerySchema.parse(query);

  const result = await Database.auditLogs.getAllPaginated({
    actorUserId: parsed.actor ? Number(parsed.actor) : undefined,
    action: parsed.action,
    target: parsed.target,
    since: parsed.since ? new Date(parsed.since) : undefined,
    until: parsed.until ? new Date(parsed.until) : undefined,
    limit: parsed.limit,
    offset: parsed.offset,
  });

  return {
    items: result.items.map((item) => ({
      id: item.id,
      actorUserId: item.actorUserId,
      action: item.action,
      target: item.target ? (JSON.parse(item.target) as object) : null,
      result: item.result,
      ts: item.ts,
    })),
    total: result.total,
  };
});
