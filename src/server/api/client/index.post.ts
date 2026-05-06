import { ClientCreateSchema } from '#db/repositories/client/types';
import { getEngine } from '../../engines/registry';
import { syncOrEnqueue } from '../../utils/syncOrEnqueue';
import { roles } from '#shared/utils/permissions';

export default definePermissionEventHandler(
  'clients',
  'create',
  async ({ event }) => {
    const { name, expiresAt, userId, newUser, trafficGroupId } = await readValidatedBody(
      event,
      validateZod(ClientCreateSchema, event)
    );

    let resolvedUserId = userId;

    // Owner picker UI is deferred (see PRD-60-05 follow-up). When neither
    // userId nor newUser is supplied we fall back to auto-creating an
    // end-user named after the client so /api/client requests work with
    // just { name, expiresAt }. Body that *does* supply ownership keeps
    // the explicit semantics.
    if (newUser && !resolvedUserId) {
      const created = await Database.users.createEndUser(newUser.name);
      resolvedUserId = created.id;
    }

    if (!resolvedUserId) {
      const created = await Database.users.createEndUser(name);
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

      // Validate that the user is not a sub-account
      if (targetUser.parentUserId) {
        throw createError({
          statusCode: 403,
          statusMessage: 'Sub-accounts cannot create clients. Please use the parent account.',
        });
      }
    }

    // Determine traffic group assignment
    let assignedTrafficGroupId = trafficGroupId;

    if (!assignedTrafficGroupId && resolvedUserId) {
      const targetUser = await Database.users.get(resolvedUserId);
      if (targetUser?.defaultTrafficGroupId) {
        assignedTrafficGroupId = targetUser.defaultTrafficGroupId;
      } else {
        // Inherit from an existing peer of the same user so all VPN
        // connections under one account share the same plan badge by
        // default. The user can still override via the form/edit page.
        const existing = await Database.clients.getForUser(resolvedUserId);
        const existingWithGroup = existing.find((c) => c.trafficGroupId);
        if (existingWithGroup?.trafficGroupId) {
          assignedTrafficGroupId = existingWithGroup.trafficGroupId;
        }
      }
    }

    // If still no group assigned, use system default
    if (!assignedTrafficGroupId) {
      const defaultGroup = await Database.trafficGroups.getDefault();
      if (defaultGroup) {
        assignedTrafficGroupId = defaultGroup.id;
      }
    }

    const result = await Database.clients.create({
      name,
      expiresAt,
      userId: resolvedUserId,
      trafficGroupId: assignedTrafficGroupId,
    });
    const clientId = result[0]!.clientId;

    const iface = await Database.interfaces.get();
    const engine = getEngine(iface.engineType);
    const clients = await Database.clients.getAll();
    const { queued } = await syncOrEnqueue(engine, iface, clients, clientId);

    return { success: true, clientId, queued };
  }
);
