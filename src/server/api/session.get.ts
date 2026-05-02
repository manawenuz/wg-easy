import type { SharedPublicUser } from '~~/shared/utils/permissions';

export default defineEventHandler(async (event) => {
  const principal = await resolvePrincipal(event);

  if (!principal) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not authenticated',
    });
  }

  const user = principal.user;

  return {
    id: user.id,
    role: user.role,
    username: user.username,
    name: user.name,
    email: user.email,
    totpVerified: user.totpVerified,
  } satisfies SharedPublicUser;
});
