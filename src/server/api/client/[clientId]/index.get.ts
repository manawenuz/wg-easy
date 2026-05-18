import { getEngine } from '../../../engines/registry';
import { ClientGetSchema } from '#db/repositories/client/types';

export default definePermissionEventHandler(
  'clients',
  'view',
  async ({ event, checkPermissions }) => {
    const { clientId } = await getValidatedRouterParams(
      event,
      validateZod(ClientGetSchema, event)
    );

    const result = await Database.clients.get(clientId);
    checkPermissions(result);

    if (!result) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Client not found',
      });
    }

    const iface = await Database.interfaces.get();
    const engine = getEngine(iface.engineType);
    const usage = await engine.sampleUsage(iface);
    const data = usage.find((s) => s.publicKey === result.publicKey);
    const rootId = await Database.users.getRootUserId(result.userId);
    const quota = await Database.quotas.getByUserId(rootId);

    return {
      ...result,
      endpoint: data?.endpoint ?? null,
      rootUserId: rootId,
      quota: quota
        ? {
            limitBytes: quota.limitBytes,
            usedBytes: quota.usedBytes,
            period: quota.period,
            periodEnd: quota.periodEnd,
          }
        : undefined,
    };
  }
);
