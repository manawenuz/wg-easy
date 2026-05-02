import { ClientGetSchema } from '#db/repositories/client/types';
import { getEngine } from '../../../engines/registry';

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

    return {
      ...result,
      endpoint: data?.endpoint ?? null,
    };
  }
);
