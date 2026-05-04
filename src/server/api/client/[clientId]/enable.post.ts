import { ClientGetSchema } from '#db/repositories/client/types';
import { getEngine } from '../../../engines/registry';

export default definePermissionEventHandler(
  'clients',
  'update',
  async ({ event, checkPermissions }) => {
    const { clientId } = await getValidatedRouterParams(
      event,
      validateZod(ClientGetSchema, event)
    );

    const client = await Database.clients.get(clientId);
    checkPermissions(client);

    if (
      client &&
      client.expiresAt !== null &&
      new Date() > new Date(client.expiresAt)
    ) {
      throw createError({
        statusCode: 422,
        statusMessage:
          'Client is expired. Please update the expiration date first.',
        message: 'Client is expired. Please update the expiration date first.',
      });
    }

    await Database.clients.toggle(clientId, true);

    const iface = await Database.interfaces.get();
    const engine = getEngine(iface.engineType);
    const clients = await Database.clients.getAll();
    await engine.syncInterface(iface, clients);

    return { success: true };
  }
);
