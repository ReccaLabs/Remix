import { defineConfig } from 'vitest/config';

// `unit`: unit tests next to the code (src/**/*.test.ts) and e2e tests of the core pipeline
// against the real Nest app with in-memory doubles (test/*.test.ts).
// `integration`: the database-backed modules against a real Postgres 18 in Docker
// (Testcontainers) with the real migrations, roles and RLS (test/integration/**/*.int.test.ts).
// `valkey`: the Valkey limiter and BullMQ jobs against a real Valkey (`VALKEY_URL`, default
// redis://127.0.0.1:6379 = the dev stack in infra/docker). Skipped with a warning when it is not
// reachable, except in CI where that is a failure (test/valkey/support.ts).
// Vite's oxc transform takes the decorator settings from tsconfig.json, exactly like the
// tsdown build.
export default defineConfig({
  test: {
    // Each isolated Nest/DB worker loads a large module graph and owns connection pools.
    // Bound resource contention under the monorepo run instead of extending test timeouts.
    maxWorkers: 2,
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
      {
        extends: true,
        test: {
          name: 'valkey',
          include: ['test/valkey/**/*.valkey.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
