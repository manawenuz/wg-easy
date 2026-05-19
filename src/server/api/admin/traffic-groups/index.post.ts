import { TrafficGroupCreateSchema } from '#db/repositories/trafficGroup/types';

export default definePermissionEventHandler(
  'admin',
  'any',
  async ({ event }) => {
    const body = await readValidatedBody(
      event,
      validateZod(TrafficGroupCreateSchema, event)
    );

    try {
      const group = await Database.trafficGroups.create(body);
      if (!group) {
        throw new Error('Failed to create traffic group');
      }
      return { id: group.id };
    } catch (error) {
      if (error instanceof Error) {
        throw createError({
          statusCode: 400,
          statusMessage: error.message,
        });
      }
      throw error;
    }
  }
);
