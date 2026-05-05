import { getEngine } from '../../../../engines/registry';
import { syncOrEnqueue } from '../../../../utils/syncOrEnqueue';

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'router:admin');

  const raw = getRouterParam(event, 'id');
  const id = Number(raw);
  // The 'self' router has id=0, which falsy-checks would reject.
  if (raw == null || Number.isNaN(id) || id < 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid router ID' });
  }

  const router = await Database.routers.get(id);
  if (!router) {
    throw createError({ statusCode: 404, statusMessage: 'Router not found' });
  }
  if (!router.enabled) {
    throw createError({ statusCode: 400, statusMessage: 'Router is disabled' });
  }

  // Bind the single active interface to this router. The MikroTik must already
  // have a matching wg interface (provisioned by the Bootstrap Wizard) — this
  // endpoint only flips the local pointer; it does not provision on-router.
  const iface = await Database.interfaces.get();

  await Database.interfaces.update({
    engineType: router.engineType,
    routerId: router.id,
  } as Parameters<typeof Database.interfaces.update>[0]);

  await logAction(event, 'router.activate', { routerId: id, name: router.name });

  // Trigger a sync so any clients in the DB show up on the new target.
  const refreshed = await Database.interfaces.get();
  const engine = getEngine(refreshed.engineType);
  const clients = await Database.clients.getAll();
  const { queued } = await syncOrEnqueue(engine, refreshed, clients);

  return {
    ok: true,
    routerId: id,
    previousEngine: iface.engineType,
    queued,
  };
});
