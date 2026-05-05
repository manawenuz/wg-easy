import { getEngine } from '../engines/registry';

export async function runExpirationEnforcer() {
  const expired = await Database.clients.findExpired(new Date());
  if (expired.length === 0) return;

  const iface = await Database.interfaces.get();
  const engine = getEngine(iface.engineType);

  for (const client of expired) {
    try {
      await Database.clients.toggle(client.id, false);
      await engine.disablePeer(iface, client.publicKey);
      await Database.auditLogs.create({
        action: 'client.expired',
        target: { clientId: client.id, expiresAt: client.expiresAt, action: 'auto-disable' },
        result: 'ok',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await Database.auditLogs.create({
        action: 'client.expired',
        target: { clientId: client.id, expiresAt: client.expiresAt, result: 'error', error: message },
        result: 'error',
      });
    }
  }
}
