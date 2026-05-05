import { getEngine } from '../engines/registry';

process.on('uncaughtException', (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  const suppress = ['!empty', 'UNKNOWNREPLY', 'SOCKTMOUT', 'unknown parameter', 'routeros'];
  if (suppress.some(s => msg.includes(s))) {
    console.warn('[uncaughtException] suppressed:', msg.substring(0, 120));
    return;
  }
  console.error('[uncaughtException]', err);
  process.exit(1);
});

export default defineNitroPlugin((nitroApp) => {
  console.log(`====================================================`);
  console.log(`    wg-easy - https://github.com/wg-easy/wg-easy    `);
  console.log(`====================================================`);
  console.log(`| wg-easy:  ${RELEASE.padEnd(38)} |`);
  console.log(`| Node:     ${process.version.padEnd(38)} |`);
  console.log(`| Platform: ${process.platform.padEnd(38)} |`);
  console.log(`| Arch:     ${process.arch.padEnd(38)} |`);
  console.log(`====================================================`);
  nitroApp.hooks.hook('close', async () => {
    console.log('Shutting down');
    const iface = await Database.interfaces.get();
    const engine = getEngine(iface.engineType);
    await engine.bringDown(iface);
  });
});
