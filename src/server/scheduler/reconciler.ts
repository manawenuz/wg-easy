import debug from 'debug';
import { getEngine } from '../engines/registry';

const RECONCILER_DEBUG = debug('Reconciler');

export async function runReconciler() {
  const iface = await Database.interfaces.get();
  const engine = getEngine(iface.engineType);
  const clients = await Database.clients.getAll();

  try {
    await engine.syncInterface(iface, clients);
    await Database.auditLogs.create({
      action: 'engine.reconcile.ok',
      target: { interfaceId: iface.id, clientCount: clients.length },
      result: 'ok',
    });
    RECONCILER_DEBUG(`Reconcile OK for interface ${iface.id} (${clients.length} peers)`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await Database.auditLogs.create({
      action: 'engine.reconcile.error',
      target: { interfaceId: iface.id, error },
      result: 'error',
    });
    RECONCILER_DEBUG(`Reconcile error for interface ${iface.id}: ${error}`);
    throw err;
  }
}
