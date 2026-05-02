import type { H3Event } from 'h3';

export async function logAction(
  event: H3Event,
  action: string,
  target?: object,
  result: 'ok' | 'error' = 'ok'
): Promise<void> {
  const p = event.context.principal;
  await Database.auditLogs.create({
    actorUserId: p?.user.id ?? null,
    action,
    target,
    result,
  });
}
