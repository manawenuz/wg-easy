import { ClientGetSchema } from '#db/repositories/client/types';
import { getEngine } from '../../../engines/registry';
import { syncOrEnqueue } from '../../../utils/syncOrEnqueue';

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

    await Database.clients.toggle(clientId, false);

    const iface = await Database.interfaces.get();
    const engine = getEngine(iface.engineType);
    const clients = await Database.clients.getAll();
    const { queued } = await syncOrEnqueue(engine, iface, clients, clientId);

    return { success: true, queued };
  }
);
