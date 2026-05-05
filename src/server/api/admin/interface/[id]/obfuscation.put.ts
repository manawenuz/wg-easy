import z from 'zod';
import { randomBytes } from 'node:crypto';
import { getEngine } from '../../../../engines/registry';
import type { MikrotikEngine } from '../../../../engines/mikrotik';
import { writeConfig as writeHostConfig, removeConfig as removeHostConfig } from '../../../../services/hostObfuscator';

const ObfuscationSchema = z.object({
  enabled: z.boolean(),
  // 'router' = old behavior (RouterOS container). 'host' = sidecar in
  // docker-compose alongside wg-easy. Defaults to 'host' on new enables.
  deploymentMode: z.enum(['router', 'host']).optional(),
  listenPort: z.number().int().min(1).max(65535).optional().nullable(),
  wgTargetPort: z.number().int().min(1).max(65535).optional().nullable(),
  hostEndpoint: z.string().optional().nullable(),
  key: z.string().optional().nullable(),
  dummyPaddingMin: z.number().int().min(0).max(1024).optional().nullable(),
  dummyPaddingMax: z.number().int().min(0).max(1024).optional().nullable(),
  // Router-mode only: trigger the in-router container deploy. Ignored in
  // host mode (the sidecar lifecycle is operator-managed via compose).
  deployEnabled: z.boolean().optional().default(false),
});

export default definePermissionEventHandler(
  'admin',
  'any',
  async ({ event }) => {
    const id = getRouterParam(event, 'id');
    if (!id) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid interface ID' });
    }

    const body = await readValidatedBody(
      event,
      validateZod(ObfuscationSchema, event)
    );

    const iface = await Database.interfaces.get(id);
    if (iface.engineType !== 'mikrotik') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Obfuscation is only supported for MikroTik interfaces',
      });
    }

    const existing = await Database.wgObfuscatorConfigs.get(id);
    const mode = body.deploymentMode ?? existing?.deploymentMode ?? 'host';

    if (body.enabled) {
      if (!body.listenPort || !body.wgTargetPort) {
        throw createError({
          statusCode: 400,
          statusMessage: 'listenPort and wgTargetPort are required when enabling obfuscation',
        });
      }

      const key = body.key ?? existing?.key ?? randomBytes(16).toString('base64');

      if (mode === 'host') {
        // Host mode: figure out the address clients should hit. Prefer
        // explicit hostEndpoint; fall back to existing record; finally to
        // the WG_HOST env. If none are set, refuse — clients need a target.
        const hostEndpoint =
          body.hostEndpoint ?? existing?.hostEndpoint ?? process.env.WG_HOST ?? null;
        if (!hostEndpoint) {
          throw createError({
            statusCode: 400,
            statusMessage: 'hostEndpoint is required for host mode (or set WG_HOST env)',
          });
        }

        // The sidecar forwards plain WG to the MikroTik's wg listen port.
        // Resolve the target host from the router record.
        const router = iface.routerId
          ? await Database.routers.get(iface.routerId)
          : null;
        const wgTargetHost = router?.host ?? null;
        if (!wgTargetHost) {
          throw createError({
            statusCode: 400,
            statusMessage: 'Cannot resolve router host for host-mode obfuscator forwarding',
          });
        }

        await writeHostConfig({
          ifaceName: id,
          listenPort: body.listenPort,
          wgTargetHost,
          wgTargetPort: body.wgTargetPort,
          key,
          dummyPaddingMax: body.dummyPaddingMax ?? undefined,
        });

        if (existing) {
          await Database.wgObfuscatorConfigs.update(id, {
            listenPort: body.listenPort,
            wgTargetPort: body.wgTargetPort,
            key,
            dummyPaddingMin: body.dummyPaddingMin ?? 8,
            dummyPaddingMax: body.dummyPaddingMax ?? 64,
            deploymentMode: 'host',
            hostEndpoint,
            deployEnabled: false,
          });
        } else {
          await Database.wgObfuscatorConfigs.create({
            interfaceId: id,
            listenPort: body.listenPort,
            wgTargetPort: body.wgTargetPort,
            key,
            dummyPaddingMin: body.dummyPaddingMin ?? 8,
            dummyPaddingMax: body.dummyPaddingMax ?? 64,
            deploymentMode: 'host',
            hostEndpoint,
            deployEnabled: false,
          });
        }

        // If we're switching from router mode, tear down the router-side
        // container so it doesn't keep listening behind our back.
        if (existing && existing.deploymentMode === 'router') {
          try {
            const engine = getEngine('mikrotik') as MikrotikEngine;
            await engine.removeObfuscator(iface);
          } catch (err) {
            // Don't fail the call — the host-side config is already
            // written and the operator can clean up the router by hand.
            console.warn('[obfuscation] router-side teardown on mode-switch failed:', (err as Error).message);
          }
        }

        await logAction(event, 'interface.obfuscation.enable', { interfaceId: id, mode: 'host' });
      } else {
        // Router mode: existing flow.
        const engine = getEngine('mikrotik') as MikrotikEngine;
        const deployResult = await engine.deployObfuscator(iface, {
          ifaceName: iface.name,
          listenPort: body.listenPort,
          wgTargetPort: body.wgTargetPort,
          key,
          dummyPaddingMin: body.dummyPaddingMin ?? undefined,
          dummyPaddingMax: body.dummyPaddingMax ?? undefined,
          deployEnabled: body.deployEnabled,
        });

        if (existing) {
          await Database.wgObfuscatorConfigs.update(id, {
            listenPort: deployResult.listenPort,
            wgTargetPort: deployResult.wgTargetPort,
            key: deployResult.key,
            dummyPaddingMin: deployResult.dummyPaddingMin,
            dummyPaddingMax: deployResult.dummyPaddingMax,
            deployEnabled: deployResult.deployEnabled,
            deploymentMode: 'router',
          });
        } else {
          await Database.wgObfuscatorConfigs.create({
            interfaceId: id,
            listenPort: deployResult.listenPort,
            wgTargetPort: deployResult.wgTargetPort,
            key: deployResult.key,
            dummyPaddingMin: deployResult.dummyPaddingMin,
            dummyPaddingMax: deployResult.dummyPaddingMax,
            deployEnabled: deployResult.deployEnabled,
            deploymentMode: 'router',
          });
        }

        // If switching from host → router, drop the host config file.
        if (existing && existing.deploymentMode === 'host') {
          await removeHostConfig(id).catch(() => {});
        }

        await logAction(event, 'interface.obfuscation.enable', { interfaceId: id, mode: 'router' });
      }
    } else {
      if (existing) {
        if (existing.deploymentMode === 'host') {
          await removeHostConfig(id).catch(() => {});
        } else {
          const engine = getEngine('mikrotik') as MikrotikEngine;
          await engine.removeObfuscator(iface);
        }
        await Database.wgObfuscatorConfigs.delete(id);
        await logAction(event, 'interface.obfuscation.disable', { interfaceId: id });
      }
    }

    return { success: true };
  }
);
