// pnpm dev — one command for local development:
//   1. start the infra stack (Postgres, Valkey, Mailpit, S3) and wait until healthy
//   2. apply migrations (idempotent)
//   3. seed the dev tenants if the database has none (`--reseed` forces it; the seed is reset-first)
//   4. run the site (:3000), web (:3001) and API (:4000) dev servers through turbo
// Ctrl+C stops the servers; the stack keeps running (`pnpm dev:stack down` to stop it).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { compose, composePort, devDatabaseUrls, must, root, run } from './lib.mjs';

const reseed = process.argv.includes('--reseed');

await must(run('node', ['scripts/dev-stack.mjs']));
await must(run('node', ['scripts/db.mjs', 'migrate']));

const count = await compose(
  [
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'postgres',
    '-d',
    'remix',
    '-tAc',
    'SELECT count(*) FROM tenants',
  ],
  { capture: true },
);
const hasTenants = count.code === 0 && Number(count.stdout.trim()) > 0;
if (reseed || !hasTenants) {
  console.log(reseed ? 'Reseeding dev data...' : 'No tenants yet, seeding dev data...');
  await must(run('node', ['scripts/db.mjs', 'seed']));
} else {
  console.log('Dev data already seeded (pnpm dev --reseed to reset it).');
}

// Defaults for the servers, only where the developer has not configured them already.
const env = { DATABASE_URL: process.env.DATABASE_URL || devDatabaseUrls().app };
if (!['apps/web/.env.local', 'apps/web/.env'].some((f) => existsSync(resolve(root, f)))) {
  env.API_INTERNAL_URL = process.env.API_INTERNAL_URL || 'http://localhost:4000';
  env.TENANT_BASE_DOMAINS = process.env.TENANT_BASE_DOMAINS || 'localhost';
  env.PLATFORM_HOSTS = process.env.PLATFORM_HOSTS || 'admin.localhost';
}
// ADR 0009: the dev stack's SeaweedFS for slips and receipts (dev-only keys from
// infra/docker/seaweedfs/s3.json), unless apps/api/.env configures storage itself. The web proxy
// reads STORAGE_ORIGIN to allow the browser to upload to and load images from it (CSP).
if (!existsSync(resolve(root, 'apps/api/.env'))) {
  const s3 = `http://127.0.0.1:${composePort('S3_PORT', '8333')}`;
  env.STORAGE_S3_ENDPOINT = process.env.STORAGE_S3_ENDPOINT || s3;
  env.STORAGE_S3_REGION = process.env.STORAGE_S3_REGION || 'us-east-1';
  env.STORAGE_S3_BUCKET = process.env.STORAGE_S3_BUCKET || 'remix-dev';
  env.STORAGE_S3_ACCESS_KEY_ID = process.env.STORAGE_S3_ACCESS_KEY_ID || 'remix_s3_dev';
  env.STORAGE_S3_SECRET_ACCESS_KEY = process.env.STORAGE_S3_SECRET_ACCESS_KEY || 'remix_s3_dev_password';
}
env.STORAGE_ORIGIN = process.env.STORAGE_ORIGIN || `http://127.0.0.1:${composePort('S3_PORT', '8333')}`;

console.log(
  '\nDev servers: site http://localhost:3000/en/ | web http://kamalphysics.localhost:3001 | api http://localhost:4000\n',
);
// Loose env mode so the variables above reach the servers (turbo's strict mode would drop them).
const { code } = await run(
  'pnpm',
  [
    'exec',
    'turbo',
    'run',
    'dev',
    '--filter=@remix/site',
    '--filter=@remix/web',
    '--filter=@remix/api',
    '--env-mode=loose',
  ],
  { env },
);
process.exit(code);
