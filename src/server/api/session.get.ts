import { roles } from '#shared/utils/permissions';
import type { SharedPublicUser } from '#shared/utils/permissions';

export default defineEventHandler(async (event) => {
  const principal = await resolvePrincipal(event);

  if (!principal) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not authenticated',
    });
  }

  const user = principal.user;

  // Dashboard user sessions have an effective role of CLIENT regardless of
  // the underlying user's role, and the displayed name is the client name.
  let role = user.role;
  let name = user.name;
  if (principal.kind === 'user') {
    role = roles.CLIENT;
    // name comes from the user record (PRD-60-05 model: session bound to user, not a single client)
  }

  return {
    id: user.id,
    role,
    username: user.username,
    name,
    email: user.email,
    totpVerified: user.totpVerified,
  } satisfies SharedPublicUser;
});
