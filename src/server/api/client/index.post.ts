import { ClientCreateSchema } from '#db/repositories/client/types';
import { getEngine } from '../../engines/registry';

export default definePermissionEventHandler(
  'clients',
  'create',
  async ({ event }) => {
    const { name, expiresAt } = await readValidatedBody(
      event,
      validateZod(ClientCreateSchema, event)
    );

    const result = await Database.clients.create({ name, expiresAt });

    const iface = await Database.interfaces.get();
    const engine = getEngine(iface.engineType);
    const clients = await Database.clients.getAll();
    await engine.syncInterface(iface, clients);

    const clientId = result[0]!.clientId;
    return { success: true, clientId };
  }
);
