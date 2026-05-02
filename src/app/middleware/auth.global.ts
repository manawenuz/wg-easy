import { roles } from '#shared/utils/permissions';

export default defineNuxtRouteMiddleware(async (to) => {
  // api & setup handled server side
  if (to.path.startsWith('/api/') || to.path.startsWith('/setup')) {
    return;
  }

  const dashboardEnabled = process.env.ENABLE_USER_DASHBOARD !== 'false';

  // Hide dashboard routes when feature flag is off
  if (!dashboardEnabled && to.path.startsWith('/dashboard')) {
    return abortNavigation();
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

  // Dashboard login: redirect to dashboard if already logged in
  if (to.path === '/dashboard/login') {
    if (authStore.userData?.username) {
      return navigateTo('/dashboard', { redirectCode: 302 });
    }
    return;
  }

  // Require auth for dashboard pages
  if (to.path.startsWith('/dashboard')) {
    if (!authStore.userData?.username) {
      return navigateTo('/dashboard/login', { redirectCode: 302 });
    }
    return;
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
      return navigateTo('/dashboard?toast=no-permission', { redirectCode: 302 });
    }
  }
});
