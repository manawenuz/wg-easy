import z from 'zod';
import { getEngine } from '../../../../engines/registry';
import type { MikrotikEngine } from '../../../../engines/mikrotik';

const ObfuscationSchema = z.object({
  enabled: z.boolean(),
  listenPort: z.number().int().min(1).max(65535).optional().nullable(),
  wgTargetPort: z.number().int().min(1).max(65535).optional().nullable(),
  key: z.string().optional().nullable(),
  dummyPaddingMin: z.number().int().min(0).max(1024).optional().nullable(),
  dummyPaddingMax: z.number().int().min(0).max(1024).optional().nullable(),
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

    if (body.enabled) {
      if (!body.listenPort || !body.wgTargetPort) {
        throw createError({
          statusCode: 400,
          statusMessage: 'listenPort and wgTargetPort are required when enabling obfuscation',
        });
      }

      const engine = getEngine('mikrotik') as MikrotikEngine;
      const deployResult = await engine.deployObfuscator(iface, {
        ifaceName: iface.name,
        listenPort: body.listenPort,
        wgTargetPort: body.wgTargetPort,
        key: body.key ?? undefined,
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
        });
      }

      await logAction(event, 'interface.obfuscation.enable', { interfaceId: id });
    } else {
      if (existing) {
        const engine = getEngine('mikrotik') as MikrotikEngine;
        await engine.removeObfuscator(iface);
        await Database.wgObfuscatorConfigs.delete(id);
        await logAction(event, 'interface.obfuscation.disable', { interfaceId: id });
      }
    }

    return { success: true };
  }
);
