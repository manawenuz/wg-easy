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
    // Server-side: principal was resolved by Nitro server middleware
    const principal = event.context.principal;
    if (principal) {
      authStore.principal = principal;
      // Dashboard user sessions have an effective role of CLIENT regardless of
      // the underlying user record's role. This prevents privilege escalation
      // when a client config is owned by an admin user.
      const effectiveRole = principal.kind === 'user' ? roles.CLIENT : principal.user.role;
      authStore.userData = {
        id: principal.user.id,
        role: effectiveRole,
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

  // Admin-only routes: root (/), /clients/*, /admin/*, /setup/*
  const adminOnlyPaths = ['/', '/clients', '/setup'];
  const isAdminOnly =
    to.path.startsWith('/admin') ||
    to.path.startsWith('/clients') ||
    to.path === '/' ||
    to.path.startsWith('/setup');

  if (isAdminOnly && authStore.userData?.role === roles.CLIENT) {
    return navigateTo('/dashboard?toast=no-permission', { redirectCode: 302 });
  }
});
