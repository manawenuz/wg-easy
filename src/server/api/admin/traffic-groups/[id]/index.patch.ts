import { TrafficGroupUpdateSchema } from '#db/repositories/trafficGroup/types';

export default definePermissionEventHandler('admin', 'any', async ({ event }) => {
  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing id parameter' });
  }

  const body = await readValidatedBody(event, validateZod(TrafficGroupUpdateSchema, event));

  const group = await Database.trafficGroups.get(Number(id));
  if (!group) {
    throw createError({ statusCode: 404, statusMessage: 'Traffic group not found' });
  }

  try {
    await Database.trafficGroups.update(Number(id), body);
    return { ok: true };
  } catch (error) {
    if (error instanceof Error) {
      throw createError({
        statusCode: 400,
        statusMessage: error.message,
      });
    }
    throw error;
  }
});
