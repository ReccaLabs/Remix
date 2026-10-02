import { defineConfig } from 'vitest/config';

// `unit`: pure logic next to the source. `isolation`: the tenant-isolation suite against a real
// Postgres 18 in Docker (Testcontainers) — roles, migrations, RLS, grants, resolver, seed.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'isolation',
          include: ['test/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['test/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
