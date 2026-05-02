import { OneTimeLinkGetSchema } from '#db/repositories/oneTimeLink/types';
import { configgen } from '../../engines/wireguard/configgen';

export default defineEventHandler(async (event) => {
  const { oneTimeLink } = await getValidatedRouterParams(
    event,
    validateZod(OneTimeLinkGetSchema, event)
  );

  const otl = await Database.oneTimeLinks.getByOtl(oneTimeLink);
  if (!otl) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Invalid One Time Link',
    });
  }

  const client = await Database.clients.get(otl.id);
  if (!client) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Invalid One Time Link',
    });
  }

  const wgInterface = await Database.interfaces.get();
  const userConfig = await Database.userConfigs.get();

  const config = configgen.generateClientConfig(
    wgInterface,
    userConfig,
    client,
    {
      enableIpv6: !WG_ENV.DISABLE_IPV6,
    }
  );

  await Database.oneTimeLinks.erase(otl.id);

  setHeader(
    event,
    'Content-Disposition',
    `attachment; filename="${configgen.cleanClientFilename(client.name) || client.id}.conf"`
  );
  setHeader(event, 'Content-Type', 'application/octet-stream');
  return config;
});
