import { roles } from '#shared/utils/permissions';

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin:users');

  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing id parameter' });
  }

  const parentUser = await Database.users.get(Number(id));
  if (!parentUser) {
    throw createError({ statusCode: 404, statusMessage: 'Parent user not found' });
  }

  // Validate that parent is not a sub-account
  if (parentUser.parentUserId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Cannot create sub-account of a sub-account',
    });
  }

  const body = await readBody(event);
  const { name, email } = body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Name is required',
    });
  }

  // Create sub-account using createEndUser pattern
  const created = await Database.users.createEndUser(name.trim(), email);

  // Update the created user to set parent_user_id
  await Database.users.update(created.id, {
    parentUserId: Number(id),
  });

  return {
    id: created.id,
    username: created.username,
  };
});
