import { ClientGetSchema } from '#db/repositories/client/types';
import { configgen } from '../../../engines/wireguard/configgen';

export default definePermissionEventHandler(
  'clients',
  'view',
  async ({ event, checkPermissions }) => {
    const { clientId } = await getValidatedRouterParams(
      event,
      validateZod(ClientGetSchema, event)
    );
    const client = await Database.clients.get(clientId);
    checkPermissions(client);

    if (!client) {
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
  }
);
