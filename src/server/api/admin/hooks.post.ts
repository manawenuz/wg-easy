import { HooksUpdateSchema } from '#db/repositories/hooks/types';
import { getEngine } from '../../engines/registry';
import { syncOrEnqueue } from '../../utils/syncOrEnqueue';

export default definePermissionEventHandler(
  'admin',
  'any',
  async ({ event }) => {
    const data = await readValidatedBody(
      event,
      validateZod(HooksUpdateSchema, event)
    );
    await Database.hooks.update(data);

    const iface = await Database.interfaces.get();
    const engine = getEngine(iface.engineType);
    const clients = await Database.clients.getAll();
    const { queued } = await syncOrEnqueue(engine, iface, clients);

    return { success: true, queued };
  }
);
