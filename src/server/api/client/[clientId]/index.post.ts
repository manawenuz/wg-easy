import { setSpeedLimit } from '../../../services/speedLimitService';
import { getEngine } from '../../../engines/registry';
import {
  ClientGetSchema,
  ClientUpdateSchema,
} from '#db/repositories/client/types';

export default definePermissionEventHandler(
  'clients',
  'update',
  async ({ event, checkPermissions }) => {
    const { clientId } = await getValidatedRouterParams(
      event,
      validateZod(ClientGetSchema, event)
    );

    const data = await readValidatedBody(
      event,
      validateZod(ClientUpdateSchema, event)
    );

    const client = await Database.clients.get(clientId);
    checkPermissions(client);

    const oldClient = await Database.clients.get(clientId);
    const ipChanged =
      oldClient &&
      (data.ipv4Address !== undefined || data.ipv6Address !== undefined) &&
      (data.ipv4Address !== oldClient.ipv4Address ||
        data.ipv6Address !== oldClient.ipv6Address);

    await Database.clients.update(clientId, data);

    const iface = await Database.interfaces.get();
    const engine = getEngine(iface.engineType);
    const clients = await Database.clients.getAll();
    await engine.syncInterface(iface, clients);

    // Re-apply speed limit if IP changed
    if (ipChanged && oldClient) {
      const speedLimit = await Database.speedLimits.getByClientId(clientId);
      if (speedLimit) {
        try {
          await engine.clearSpeedLimit(iface, oldClient.publicKey);
          await setSpeedLimit(clientId, speedLimit.upKbps, speedLimit.downKbps);
        } catch (err) {
          console.error('Failed to reapply speed limit after IP change:', err);
        }
      }
    }

    return { success: true };
  }
);
