import { ClientGetSchema } from '#db/repositories/client/types';
import { configgen } from '../../../engines/wireguard/configgen';
import { encodeQRCode } from '../../../utils/qr';

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

    const svg = encodeQRCode(config);
    setHeader(event, 'Content-Type', 'image/svg+xml');
    return svg;
  }
);
