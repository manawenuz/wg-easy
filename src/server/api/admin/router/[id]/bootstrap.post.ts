import z from 'zod';
import { getEngine } from '../../../../engines/registry';
import type { MikrotikEngine } from '../../../../engines/mikrotik';
import type { ProgressEvent } from '../../../../engines/mikrotik/bootstrap';

const BootstrapSchema = z.object({
  ifaceName: z.string().min(1).pipe(safeStringRefine),
  listenPort: z.number().int().min(1).max(65535),
  ipv4Cidr: z.string().min(1),
  ipv6Cidr: z.string().optional().nullable(),
  wanInterface: z.string().optional().nullable(),
  sshUser: z.string().min(1),
  sshPassword: z.string().optional().nullable(),
  sshKey: z.string().optional().nullable(),
});

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'));
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid router ID' });
  }
  await requirePermission(event, 'router:admin', { routerId: id });

  const router = await Database.routers.get(id);
  if (!router) {
    throw createError({ statusCode: 404, statusMessage: 'Router not found' });
  }

  if (router.engineType !== 'mikrotik') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bootstrap is only supported for MikroTik routers',
    });
  }

  const body = await readValidatedBody(
    event,
    validateZod(BootstrapSchema, event)
  );

  const res = event.node!.res as import('node:http').ServerResponse;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data: ProgressEvent) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const engine = getEngine('mikrotik') as MikrotikEngine;

  await logAction(event, 'router.bootstrap', { routerId: id });

  try {
    await engine.bootstrap(
      router,
      {
        ifaceName: body.ifaceName,
        listenPort: body.listenPort,
        ipv4Cidr: body.ipv4Cidr,
        ipv6Cidr: body.ipv6Cidr ?? undefined,
        wanInterface: body.wanInterface ?? undefined,
        sshUser: body.sshUser,
        sshPassword: body.sshPassword ?? undefined,
        sshKey: body.sshKey ?? undefined,
      },
      send
    );
  } catch (err) {
    send({
      step: 'bootstrap',
      status: 'error',
      detail: err instanceof Error ? err.message : 'Bootstrap failed',
      recovery: 'Check server logs and retry.',
    });
  } finally {
    res.end();
  }
});
