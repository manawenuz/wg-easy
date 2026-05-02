import {
  ClientGetSchema,
  ClientUpdateSchema,
} from '#db/repositories/client/types';
import { getEngine } from '../../../engines/registry';

export default definePermissionEventHandler(
  'clients',
  'update',
  async ({ event, checkPermissions }) => {
    const { clientId } = await getValidatedRouterParams(
      event,
      validateZod(ClientGetSchema, event)
    );

    const data = await readValidatedBody(
      event,
      validateZod(ClientUpdateSchema, event)
    );

    const client = await Database.clients.get(clientId);
    checkPermissions(client);

    await Database.clients.update(clientId, data);

    const iface = await Database.interfaces.get();
    const engine = getEngine('wireguard');
    const clients = await Database.clients.getAll();
    await engine.syncInterface(iface, clients);

    return { success: true };
  }
);
