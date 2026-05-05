import debug from 'debug';
import { getEngine } from '../engines/registry';

const RECONCILER_DEBUG = debug('Reconciler');

export async function runReconciler() {
  const iface = await Database.interfaces.get();
  const engine = getEngine(iface.engineType);
  const clients = await Database.clients.getAll();
  const routerId = iface.routerId ?? null;

  try {
    await engine.syncInterface(iface, clients);

    if (routerId) {
      const { recovered } = await Database.routers.recordHealth(routerId, true);
      if (recovered) {
        const router = await Database.routers.get(routerId);
        await Database.auditLogs.create({
          action: 'engine.recovered',
          target: { routerId, routerName: router?.name },
          result: 'ok',
        });
        RECONCILER_DEBUG(`Router ${routerId} recovered`);
      }
    }

    await Database.auditLogs.create({
      action: 'engine.reconcile.ok',
      target: { interfaceId: iface.name, clientCount: clients.length },
      result: 'ok',
    });
    RECONCILER_DEBUG(`Reconcile OK for interface ${iface.name} (${clients.length} peers)`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    if (routerId) {
      const { crossedThreshold } = await Database.routers.recordHealth(routerId, false, error);
      if (crossedThreshold) {
        const router = await Database.routers.get(routerId);
        await Database.auditLogs.create({
          action: 'engine.unreachable',
          target: { routerId, routerName: router?.name, error },
          result: 'error',
        });
        RECONCILER_DEBUG(`Router ${routerId} unreachable (3 consecutive failures)`);
      }
    }

    await Database.auditLogs.create({
      action: 'engine.reconcile.error',
      target: { interfaceId: iface.name, error },
      result: 'error',
    });
    RECONCILER_DEBUG(`Reconcile error for interface ${iface.name}: ${error}`);
    throw err;
  }
}
