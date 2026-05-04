import { getEngineMetadata } from '../../engines/metadata';

export default definePermissionEventHandler('admin', 'any', async () => {
  return await getEngineMetadata();
});
