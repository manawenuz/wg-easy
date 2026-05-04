import { getEngine } from '../../../engines/registry';

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'dashboard:self');

  const principal = event.context.principal!;

  if (principal.kind !== 'user') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
    });
  }

  const client = await Database.clients.get(principal.clientId);
  if (!client) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Client not found',
    });
  }

  const iface = await Database.interfaces.get();
  const engine = getEngine(iface.engineType);
  const usage = await engine.sampleUsage(iface);

  const quotas = await Database.quotas.getAll();
  const speedLimits = await Database.speedLimits.getAll();

  const sample = usage.find((s) => s.publicKey === client.publicKey);
  const quota = quotas.find((q) => q.clientId === client.id);
  const speedLimit = speedLimits.find((sl) => sl.clientId === client.id);

  return [{
    id: client.id,
    name: client.name,
    enabled: client.enabled,
    ipv4: client.ipv4Address,
    lastHandshakeAt: sample?.lastHandshakeAt ?? null,
    rxBytes: sample ? Number(sample.rxBytes) : null,
    txBytes: sample ? Number(sample.txBytes) : null,
    expiresAt: client.expiresAt ?? null,
    quota: quota
      ? {
          limitBytes: quota.limitBytes,
          usedBytes: quota.usedBytes,
          period: quota.period,
          periodEnd: quota.periodEnd,
        }
      : undefined,
    speedLimit: speedLimit
      ? {
          upKbps: speedLimit.upKbps,
          downKbps: speedLimit.downKbps,
        }
      : undefined,
  }];
});
