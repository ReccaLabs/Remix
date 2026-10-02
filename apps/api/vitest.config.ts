import { defineConfig } from 'vitest/config';

// `unit`: unit tests next to the code (src/**/*.test.ts) and e2e tests of the core pipeline
// against the real Nest app with in-memory doubles (test/*.test.ts).
// `integration`: the database-backed modules against a real Postgres 18 in Docker
// (Testcontainers) with the real migrations, roles and RLS (test/integration/**/*.int.test.ts).
// Vite's oxc transform takes the decorator settings from tsconfig.json, exactly like the
// tsdown build.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['reflect-metadata'],
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.ts', 'test/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.int.test.ts'],
          globalSetup: ['test/integration/support/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
