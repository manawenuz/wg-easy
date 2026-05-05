import { ClientCreateSchema } from '#db/repositories/client/types';
import { getEngine } from '../../engines/registry';
import { syncOrEnqueue } from '../../utils/syncOrEnqueue';

export default definePermissionEventHandler(
  'clients',
  'create',
  async ({ event }) => {
    const { name, expiresAt } = await readValidatedBody(
      event,
      validateZod(ClientCreateSchema, event)
    );

    const result = await Database.clients.create({ name, expiresAt });
    const clientId = result[0]!.clientId;

    const iface = await Database.interfaces.get();
    const engine = getEngine(iface.engineType);
    const clients = await Database.clients.getAll();
    const { queued } = await syncOrEnqueue(engine, iface, clients, clientId);

    return { success: true, clientId, queued };
  }
);
