export default defineEventHandler(async (event) => {
  const url = getRequestURL(event);

  // Skip setup routes (no auth needed during setup)
  if (url.pathname.startsWith('/api/setup/') || url.pathname.startsWith('/setup/')) {
    return;
  }

  // Resolve principal once per request; cache on event context
  if (!event.context.principal) {
    try {
      const principal = await resolvePrincipal(event);
      if (principal) {
        event.context.principal = principal;
      }
    } catch (err) {
      console.error('[principal middleware] resolvePrincipal failed:', err);
      // Leave event.context.principal undefined so downstream
      // requirePermission returns 401 cleanly.
    }
  }
});
