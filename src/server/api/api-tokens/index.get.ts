export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin:settings');

  const principal = event.context.principal!;
  const tokens = await Database.apiTokens.getByUserId(principal.user.id);

  return tokens.map((t) => ({
    id: t.id,
    label: t.label,
    scopes: t.scopes ? (JSON.parse(t.scopes) as string[]) : [],
    expiresAt: t.expiresAt,
    lastUsedAt: t.lastUsedAt,
    createdAt: t.createdAt,
  }));
});
