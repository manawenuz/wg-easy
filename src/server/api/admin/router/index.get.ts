import { getEngineMetadata } from '../../../engines/metadata';

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'router:read');

  const routers = await Database.routers.getAll();
  const engines = await getEngineMetadata();

  return routers.map((r) => {
    const engine = engines.find((e) => e.id === r.engineType);
    return {
      ...r,
      dockerized: engine?.dockerized ?? false,
      credentialsEncrypted: undefined,
      sshPassphraseEncrypted: undefined,
    };
  });
});
