import { createOwnerDb } from '../client';
import { hashPassword } from '../password';
import { seed, SEED_PASSWORD, SEED_TENANTS } from '../seed';
import { fail, ownerUrl } from './env';

// pnpm --filter @remix/db seed — DEV ONLY. Replaces the seed tenants (kamalphysics,
// royalscience, closedacademy) with deterministic sample data.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const url = ownerUrl();
const host = new URL(url).hostname;
if (process.env.NODE_ENV === 'production') fail('Refusing to seed: NODE_ENV=production.');
if (!LOCAL_HOSTS.has(host) && process.env.SEED_ALLOW_REMOTE !== 'true') {
  fail(
    `Refusing to seed non-local database host "${host}" (set SEED_ALLOW_REMOTE=true to override).`,
  );
}

const db = createOwnerDb(url);
try {
  const started = Date.now();
  // One Argon2id hash reused for every seeded user: same dev password, fast seed.
  const summaries = await seed(db, await hashPassword(SEED_PASSWORD));
  console.table(summaries.map(({ tenantId: _id, ...rest }) => rest));
  console.log(`Seeded in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  console.log(`Dev password for every seeded user: ${SEED_PASSWORD}`);
  for (const t of SEED_TENANTS) {
    const owner = t.staff[0];
    if (owner) console.log(`  ${t.slug}: owner ${owner.name} ${owner.phone}`);
  }
} catch (error) {
  fail('Seed failed', error);
} finally {
  await db.$client.end();
}
