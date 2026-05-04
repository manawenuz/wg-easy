import { ClientGetSchema } from '#db/repositories/client/types';
import { configgen as wireguardConfiggen } from '../../../engines/wireguard/configgen';
import { configgen as amneziawgConfiggen } from '../../../engines/amneziawg/configgen';
import { encodeQRCode } from '../../../utils/qr';

function getConfiggen(engineType: string) {
  if (engineType === 'amneziawg') {
    return amneziawgConfiggen;
  }
  return wireguardConfiggen;
}

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
    const configgen = getConfiggen(wgInterface.engineType);

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
