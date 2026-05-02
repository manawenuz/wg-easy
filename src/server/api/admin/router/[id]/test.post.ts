import { getEngine } from '../../../../engines/registry';

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'router:admin');

  const id = Number(getRouterParam(event, 'id'));
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid router ID' });
  }

  const router = await Database.routers.get(id);
  if (!router) {
    throw createError({ statusCode: 404, statusMessage: 'Router not found' });
  }

  const interfaces = await Database.interfaces.getByRouterId(id);
  const iface = interfaces[0];

  if (!iface) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No interface found for this router',
    });
  }

  const engine = getEngine(router.engineType);
  const health = await engine.healthCheck(iface);

  if (!health.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: health.details || 'Connection failed',
    });
  }

  // Count peers on the router
  let peersCount = 0;
  try {
    const peers = await engine.sampleUsage(iface);
    peersCount = peers.length;
  } catch {
    // ignore peer count errors
  }

  return {
    ok: true,
    version: health.details,
    peersCount,
  };
});
