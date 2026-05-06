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
    const engine = getEngine(iface.engineType);

    let dbClients;
    // SUPERADMIN is a strict superset of ADMIN; both must see all clients.
    // promoteSingleAdminToSuperadmin means single-admin installs end up with
    // role=SUPERADMIN, so missing this check made /api/client return [] for
    // the only admin on the system.
    const isAdmin = user.role === roles.ADMIN || user.role === roles.SUPERADMIN;
    if (isAdmin) {
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
    const quotas = await Database.quotas.getAll();
    const trafficGroups = await Database.trafficGroups.getAll();

    const clients = dbClients.map((client) => {
      const sample = usage.find((s) => s.publicKey === client.publicKey);
      const quota = quotas.find((q) => q.clientId === client.id);
      const trafficGroup = client.trafficGroupId
        ? trafficGroups.find((g) => g.id === client.trafficGroupId)
        : undefined;

      return {
        ...client,
        latestHandshakeAt: sample?.lastHandshakeAt ?? null,
        endpoint: sample?.endpoint ?? null,
        transferRx: sample ? Number(sample.rxBytes) : null,
        transferTx: sample ? Number(sample.txBytes) : null,
        quota: quota
          ? {
              limitBytes: quota.limitBytes,
              usedBytes: quota.usedBytes,
              period: quota.period,
              periodEnd: quota.periodEnd,
            }
          : undefined,
        trafficGroup: trafficGroup
          ? {
              id: trafficGroup.id,
              name: trafficGroup.name,
              colorLight: trafficGroup.colorLight,
              colorDark: trafficGroup.colorDark,
            }
          : undefined,
      };
    });

    return clients;
  }
);
