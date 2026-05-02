import { ClientQuerySchema } from '#db/repositories/client/types';
import { getEngine } from '../../engines/registry';

export default definePermissionEventHandler(
  'clients',
  'custom',
  async ({ event, user }) => {
    const { filter } = await getValidatedQuery(
      event,
      validateZod(ClientQuerySchema, event)
    );

    const iface = await Database.interfaces.get();
    const engine = getEngine('wireguard');

    let dbClients;
    if (user.role === roles.ADMIN) {
      if (filter?.trim()) {
        dbClients = await Database.clients.getAllPublicFiltered(filter);
      } else {
        dbClients = await Database.clients.getAllPublic();
      }
    } else {
      if (filter?.trim()) {
        dbClients = await Database.clients.getForUserFiltered(user.id, filter);
      } else {
        dbClients = await Database.clients.getForUser(user.id);
      }
    }

    const usage = await engine.sampleUsage(iface);
    const clients = dbClients.map((client) => {
      const sample = usage.find((s) => s.publicKey === client.publicKey);
      return {
        ...client,
        latestHandshakeAt: sample?.lastHandshakeAt ?? null,
        endpoint: sample?.endpoint ?? null,
        transferRx: sample ? Number(sample.rxBytes) : null,
        transferTx: sample ? Number(sample.txBytes) : null,
      };
    });

    return clients;
  }
);
