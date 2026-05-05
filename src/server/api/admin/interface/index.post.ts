import { InterfaceUpdateSchema } from '#db/repositories/interface/types';
import { getEngine } from '../../../engines/registry';
import { syncOrEnqueue } from '../../../utils/syncOrEnqueue';
import { exec } from '../../../utils/cmd';

async function isAwgAvailable(): Promise<boolean> {
  try {
    await exec('which awg', { log: false });
    return true;
  } catch {
    return false;
  }
}

export default definePermissionEventHandler(
  'admin',
  'any',
  async ({ event }) => {
    const data = await readValidatedBody(
      event,
      validateZod(InterfaceUpdateSchema, event)
    );

    // Validate engine type against installed tools
    if (data.engineType === 'amneziawg') {
      const awgAvailable = await isAwgAvailable();
      if (!awgAvailable) {
        throw createError({
          statusCode: 400,
          statusMessage:
            'AmneziaWG is not available on this system. Please install amneziawg-tools before selecting this engine.',
        });
      }
    }

    // If enabling firewall, check if iptables is available
    if (data.firewallEnabled) {
      // Clear cache to force fresh check
      firewall.clearAvailabilityCache();

      const iptablesAvailable = await firewall.isAvailable(
        !WG_ENV.DISABLE_IPV6
      );
      if (!iptablesAvailable) {
        const requiredTools = WG_ENV.DISABLE_IPV6
          ? 'iptables'
          : 'iptables and ip6tables';
        throw createError({
          statusCode: 400,
          statusMessage: `Per-Client Firewall requires ${requiredTools} to be installed on the host system. Please install ${requiredTools} before enabling this feature.`,
        });
      }
    }

    await Database.interfaces.update(data);

    const iface = await Database.interfaces.get();
    const engine = getEngine(iface.engineType);
    const clients = await Database.clients.getAll();
    const { queued } = await syncOrEnqueue(engine, iface, clients);

    return { success: true, queued };
  }
);
