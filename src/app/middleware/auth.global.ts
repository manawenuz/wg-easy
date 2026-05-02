import { roles } from '#shared/utils/permissions';

export default defineNuxtRouteMiddleware(async (to) => {
  // api & setup handled server side
  if (to.path.startsWith('/api/') || to.path.startsWith('/setup')) {
    return;
  }

  const event = useRequestEvent();

  const authStore = useAuthStore();

  if (event) {
    // Server-side: resolve principal from the request event
    const principal = await resolvePrincipal(event);
    if (principal) {
      event.context.principal = principal;
      authStore.principal = principal;
      authStore.userData = {
        id: principal.user.id,
        role: principal.user.role,
        username: principal.user.username,
        name: principal.user.name,
        email: principal.user.email,
        totpVerified: principal.user.totpVerified,
      };
    } else {
      authStore.principal = null;
      authStore.userData = null;
    }
  } else {
    // Client-side: fall back to session fetch
    authStore.userData = await authStore.getSession();
  }

  // skip login if already logged in
  if (to.path === '/login') {
    if (authStore.userData?.username) {
      return navigateTo('/', { redirectCode: 302 });
    }
    return;
  }

  // Require auth for every page other than Login
  if (!authStore.userData?.username) {
    return navigateTo('/login', { redirectCode: 302 });
  }

  // Check for admin access (any non-client role)
  if (to.path.startsWith('/admin')) {
    if (authStore.userData?.role === roles.CLIENT) {
      return abortNavigation('Not allowed to access Admin Panel');
    }
  }
});
