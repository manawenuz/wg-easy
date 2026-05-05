import { ClientCreateSchema } from '#db/repositories/client/types';
import { getEngine } from '../../engines/registry';
import { syncOrEnqueue } from '../../utils/syncOrEnqueue';
import { roles } from '#shared/utils/permissions';

export default definePermissionEventHandler(
  'clients',
  'create',
  async ({ event }) => {
    const { name, expiresAt, userId, newUser } = await readValidatedBody(
      event,
      validateZod(ClientCreateSchema, event)
    );

    let resolvedUserId = userId;

    // If newUser is provided, create the end-user first
    if (newUser && !resolvedUserId) {
      const created = await Database.users.createEndUser(newUser.name);
      resolvedUserId = created.id;
    }

    // Validate that the target user is CLIENT-role (not an admin)
    if (resolvedUserId) {
      const targetUser = await Database.users.get(resolvedUserId);
      if (!targetUser) {
        throw createError({ statusCode: 404, statusMessage: 'User not found' });
      }
      if (targetUser.role !== roles.CLIENT) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Clients can only be owned by CLIENT-role users',
        });
      }
    }

    const result = await Database.clients.create({ name, expiresAt, userId: resolvedUserId });
    const clientId = result[0]!.clientId;

    const iface = await Database.interfaces.get();
    const engine = getEngine(iface.engineType);
    const clients = await Database.clients.getAll();
    const { queued } = await syncOrEnqueue(engine, iface, clients, clientId);

    return { success: true, clientId, queued };
  }
);
