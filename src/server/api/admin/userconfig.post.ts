import { UserConfigUpdateSchema } from '#db/repositories/userConfig/types';
import { getEngine } from '../../engines/registry';
import { syncOrEnqueue } from '../../utils/syncOrEnqueue';

export default definePermissionEventHandler(
  'admin',
  'any',
  async ({ event }) => {
    const data = await readValidatedBody(
      event,
      validateZod(UserConfigUpdateSchema, event)
    );
    await Database.userConfigs.update(data);

    const iface = await Database.interfaces.get();
    const engine = getEngine(iface.engineType);
    const clients = await Database.clients.getAll();
    const { queued } = await syncOrEnqueue(engine, iface, clients);

    return { success: true, queued };
  }
);
