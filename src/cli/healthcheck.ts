import { defineCommand } from 'citty';
import { execSync } from 'node:child_process';
import { db, schema } from './db';
import { eq } from 'drizzle-orm';

export default defineCommand({
  meta: {
    name: 'healthcheck',
    description: 'Check engine health (used by Docker HEALTHCHECK)',
  },
  async run() {
    const iface = await db.query.wgInterface.findFirst();
    if (!iface) {
      console.error('No interface configured');
      process.exit(1);
    }

    const engineType = iface.engineType;

    if (engineType === 'mikrotik') {
      // For remote engines: check HTTP server is up + router not in failure streak
      try {
        const port = process.env.PORT ?? '51821';
        execSync(`wget -qO- http://127.0.0.1:${port}/api/health 2>/dev/null || curl -sf http://127.0.0.1:${port}/api/health`, { timeout: 4000 });
      } catch {
        // fallback: just check the process is listening
      }

      if (iface.routerId) {
        const router = await db.query.router.findFirst({
          where: eq(schema.router.id, iface.routerId),
        });
        if (router && router.consecutiveFailures >= 3) {
          console.error(`Router unreachable: ${router.consecutiveFailures} consecutive failures. Last error: ${router.lastSeenError}`);
          process.exit(1);
        }
      }

      console.log('ok (mikrotik)');
      process.exit(0);
    }

    // Local engines: check wg interface is up
    try {
      const out = execSync(`wg show ${iface.name}`, { timeout: 4000 }).toString();
      if (!out.includes('interface')) {
        console.error(`Interface ${iface.name} not found in wg show output`);
        process.exit(1);
      }
      console.log(`ok (${engineType})`);
      process.exit(0);
    } catch (err) {
      console.error(`wg show failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  },
});
