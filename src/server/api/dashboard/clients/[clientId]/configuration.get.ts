import { configgen as wireguardConfiggen } from '../../../../engines/wireguard/configgen';
import { configgen as amneziawgConfiggen } from '../../../../engines/amneziawg/configgen';
import { ClientGetSchema } from '#db/repositories/client/types';

function getConfiggen(engineType: string) {
  if (engineType === 'amneziawg') {
    return amneziawgConfiggen;
  }
  return wireguardConfiggen;
}

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

  if (!client || client.id !== principal.clientId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
    });
  }

  const wgInterface = await Database.interfaces.get();
  const userConfig = await Database.userConfigs.get();
  const obfuscatorConfig =
    wgInterface.engineType === 'mikrotik'
      ? await Database.wgObfuscatorConfigs.get(wgInterface.name)
      : null;

  const configgen = getConfiggen(wgInterface.engineType);

  let config = configgen.generateClientConfig(
    wgInterface,
    userConfig,
    client,
    {
      enableIpv6: !WG_ENV.DISABLE_IPV6,
      engineType: wgInterface.engineType,
      endpointPort: obfuscatorConfig?.listenPort ?? undefined,
    }
  );

  if (obfuscatorConfig) {
    const instructions = `
# --- Obfuscation Instructions ---
# This interface uses wg-obfuscator for DPI evasion.
# You must run wg-obfuscator on your client device.
# 1. Download wg-obfuscator: https://github.com/ClusterM/wg-obfuscator
# 2. Use the following configuration for your local wg-obfuscator:
#
# [main]
# source-lport = 51830
# target = ${userConfig.host}:${obfuscatorConfig.listenPort}
# key = ${obfuscatorConfig.key}
# verbose = 2
#
# 3. Change the Endpoint in your WireGuard app to: 127.0.0.1:51830
`;
    config += `\n${instructions}`;
  }

  setHeader(
    event,
    'Content-Disposition',
    `attachment; filename="${configgen.cleanClientFilename(client.name) || clientId}.conf"`
  );

  setHeader(event, 'Content-Type', 'application/octet-stream');
  return config;
});
