import { configgen } from '../../../../engines/wireguard/configgen';
import { ClientGetSchema } from '#db/repositories/client/types';

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'dashboard:self');

  const principal = event.context.principal!;

  if (principal.kind !== 'user') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
    });
  }

  const { clientId } = await getValidatedRouterParams(
    event,
    validateZod(ClientGetSchema, event)
  );

  const client = await Database.clients.get(clientId);

  if (!client || client.userId !== principal.user.id) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Client not found',
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

  setHeader(
    event,
    'Content-Disposition',
    `attachment; filename="${configgen.cleanClientFilename(client.name) || clientId}.conf"`
  );

  setHeader(event, 'Content-Type', 'application/octet-stream');
  return config;
});
