import { InterfaceCidrUpdateSchema } from '#db/repositories/interface/types';
import { getEngine } from '../../../engines/registry';

export default definePermissionEventHandler(
  'admin',
  'any',
  async ({ event }) => {
    const data = await readValidatedBody(
      event,
      validateZod(InterfaceCidrUpdateSchema, event)
    );

    await Database.interfaces.updateCidr(data);

    const iface = await Database.interfaces.get();
    const engine = getEngine('wireguard');
    const clients = await Database.clients.getAll();
    await engine.syncInterface(iface, clients);

    return { success: true };
  }
);
