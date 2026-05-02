import { getEngine } from '../../../engines/registry';

export default definePermissionEventHandler('admin', 'any', async () => {
  const iface = await Database.interfaces.get();
  const engine = getEngine(iface.engineType);
  await engine.bringDown(iface);
  await engine.bringUp(iface);

  return { success: true };
});
