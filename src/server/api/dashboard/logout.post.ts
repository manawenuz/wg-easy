export default defineEventHandler(async (event) => {
  const sessionConfig = await Database.general.getSessionConfig();

  try {
    const session = await useSession<WGSession>(event, {
      password: sessionConfig.sessionPassword,
      name: 'wg-user-session',
      cookie: {
        secure: !WG_ENV.INSECURE,
      },
    });
    await session.clear();
  } catch {
    // ignore session errors
  }

  return { ok: true };
});
