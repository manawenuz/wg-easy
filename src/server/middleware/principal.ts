export default defineEventHandler(async (event) => {
  const url = getRequestURL(event);

  // Only resolve principal for API routes
  if (!url.pathname.startsWith('/api/')) {
    return;
  }

  // Skip setup routes (no auth needed during setup)
  if (url.pathname.startsWith('/api/setup/')) {
    return;
  }

  // Resolve principal lazily; cache on event context
  if (!event.context.principal) {
    const principal = await resolvePrincipal(event);
    if (principal) {
      event.context.principal = principal;
    }
  }
});
