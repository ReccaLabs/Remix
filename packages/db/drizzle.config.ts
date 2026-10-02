import { defineConfig } from 'drizzle-kit';

/**
 * `pnpm db:generate` diffs src/schema against migrations/meta and writes a new SQL migration.
 * RLS, grants and functions are hand-written custom migrations (`pnpm db:generate --custom
 * --name=<what>`) — see README "Adding a table". Never use `drizzle-kit push`: it would bypass
 * the hand-written security migrations.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  strict: true,
  verbose: true,
});
