import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            'test/unit/*.{test,spec}.ts',
            'test/ssr-auth.test.ts',
            'app/composables/**/*.test.ts',
            'server/engines/**/*.test.ts',
            'server/transports/**/*.test.ts',
            'server/database/migrations/**/*.test.ts',
            'server/utils/*.test.ts',
            'server/scheduler/**/*.test.ts',
            'server/services/**/*.test.ts',
            'server/middleware/**/*.test.ts',
            'server/api/**/*.test.ts',
          ],
          environment: 'node',
        },
        resolve: {
          alias: {
            '#shared': path.resolve(__dirname, './shared'),
            '#db': path.resolve(__dirname, './server/database'),
          },
        },
      },
    ],
    coverage: {
      enabled: true,
    },
  },
});
