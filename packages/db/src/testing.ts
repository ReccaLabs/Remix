// Test-database provisioning shared by the database test suites (packages/db isolation tests and
// the apps/api integration tests). TEST SUPPORT ONLY: imported by vitest global setups, never by
// application code.
//
// Default: ONE Postgres for every run. A fresh, uniquely named database (`remix_test_<id>`) is
// created per run (per project), migrated, and dropped afterwards, so parallel runs and agents
// share the server without sharing state and nothing needs a container per run.
//   - Server: `TEST_DATABASE_URL` (a superuser URL on a local host), else the dev stack from
//     infra/docker/compose.yaml on 127.0.0.1:${POSTGRES_PORT:-5432}.
//   - Roles: the four cluster roles are created when missing (the dev stack's init script
//     already did; a bare server gets them here), with the dev passwords.
// Fallback: when no such server answers (CI's `db-isolation` job), a throwaway Testcontainers
// Postgres is started instead, exactly like before. `TEST_DATABASE=container` forces it.
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from './migrate';

export interface TestDbUrls {
  superuser: string;
  owner: string;
  app: string;
  platform: string;
  readonly: string;
}

export interface TestDatabase {
  urls: TestDbUrls;
  /** Drops the database (or stops the container). Safe to call once. */
  teardown(): Promise<void>;
}

const IMAGE = 'postgres:18-alpine';
const PREFIX = 'remix_test_';
/** Databases left behind by a crashed run are dropped once they are this old. */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

// Literal statements, no interpolation. Keep in sync with infra/docker/postgres/init/01-roles.sql.
const ROLES = [
  ['remix_owner', 'remix_owner_dev_password'],
  ['remix_app', 'remix_app_dev_password'],
  ['remix_platform', 'remix_platform_dev_password'],
  ['remix_readonly', 'remix_readonly_dev_password'],
] as const;

const CREATE_ROLES = [
  "CREATE ROLE remix_owner LOGIN PASSWORD 'remix_owner_dev_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT",
  "CREATE ROLE remix_app LOGIN PASSWORD 'remix_app_dev_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT",
  "CREATE ROLE remix_platform LOGIN PASSWORD 'remix_platform_dev_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT",
  "CREATE ROLE remix_readonly LOGIN PASSWORD 'remix_readonly_dev_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT",
  "ALTER ROLE remix_owner SET timezone = 'UTC'",
  "ALTER ROLE remix_app SET timezone = 'UTC'",
  "ALTER ROLE remix_platform SET timezone = 'UTC'",
  "ALTER ROLE remix_readonly SET timezone = 'UTC'",
];

function superuserUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ||
    `postgres://postgres:postgres_dev_password@127.0.0.1:${process.env.POSTGRES_PORT || '5432'}/postgres`
  );
}

function withDatabase(base: string, user: string, password: string, database: string): string {
  const url = new URL(base);
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

/** A connected superuser client on the shared server, or null when none is reachable. */
async function connectShared(): Promise<pg.Client | null> {
  if (process.env.TEST_DATABASE === 'container') return null;
  const url = new URL(superuserUrl());
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`TEST_DATABASE_URL must point at a local host, got "${url.hostname}".`);
  }
  const client = new pg.Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 2_000,
  });
  client.on('error', () => undefined);
  try {
    await client.connect();
    return client;
  } catch {
    await client.end().catch(() => undefined);
    return null;
  }
}

async function dropDatabase(admin: pg.Client, name: string): Promise<void> {
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
}

async function provisionShared(admin: pg.Client): Promise<TestDatabase> {
  // Roles are cluster-wide and may be created concurrently by parallel runs: serialize with an
  // advisory lock instead of racing on CREATE ROLE.
  await admin.query('SELECT pg_advisory_lock(7340001)');
  try {
    const existing = await admin.query<{ rolname: string }>(
      'SELECT rolname FROM pg_roles WHERE rolname = ANY($1)',
      [ROLES.map(([name]) => name)],
    );
    if (existing.rowCount === 0) {
      for (const statement of CREATE_ROLES) await admin.query(statement);
    } else if (existing.rowCount !== ROLES.length) {
      throw new Error(
        'The shared Postgres has only some of the remix_* roles. Reset the dev stack ' +
          '(pnpm dev:stack down -v) or drop the partial roles.',
      );
    }

    // Sweep databases of crashed runs. The name carries the creation time (base 36, ms).
    const stale = await admin.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname LIKE $1',
      [`${PREFIX}%`],
    );
    for (const { datname } of stale.rows) {
      const created = Number.parseInt(datname.slice(PREFIX.length).split('_')[0] ?? '', 36);
      if (Number.isFinite(created) && Date.now() - created > STALE_AFTER_MS) {
        await dropDatabase(admin, datname);
      }
    }
  } finally {
    await admin.query('SELECT pg_advisory_unlock(7340001)');
  }

  const name = `${PREFIX}${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
  await admin.query(`CREATE DATABASE "${name}" OWNER remix_owner`);

  const base = superuserUrl();
  const [owner, app, platform, readonly] = ROLES.map(([role, password]) =>
    withDatabase(base, role, password, name),
  ) as [string, string, string, string];
  const urls: TestDbUrls = {
    superuser: withDatabase(base, new URL(base).username, new URL(base).password, name),
    owner,
    app,
    platform,
    readonly,
  };
  try {
    await runMigrations(owner);
  } catch (error) {
    await dropDatabase(admin, name);
    await admin.end();
    throw error;
  }

  let done = false;
  return {
    urls,
    async teardown() {
      if (done) return;
      done = true;
      try {
        await dropDatabase(admin, name);
      } finally {
        await admin.end();
      }
    },
  };
}

/** The pre-C4 behaviour: an ephemeral container on a random local port, test-only passwords. */
async function provisionContainer(): Promise<TestDatabase> {
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  const password = 'test-only-superuser';
  const container = await new PostgreSqlContainer(IMAGE)
    .withDatabase('postgres')
    .withUsername('postgres')
    .withPassword(password)
    .start();
  const base = `postgres://postgres:${password}@${container.getHost()}:${container.getPort()}/postgres`;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  try {
    for (const statement of CREATE_ROLES) await admin.query(statement);
    await admin.query('CREATE DATABASE remix OWNER remix_owner');
  } finally {
    await admin.end();
  }
  const url = (user: string, pass: string) => withDatabase(base, user, pass, 'remix');
  const urls: TestDbUrls = {
    superuser: url('postgres', password),
    owner: url(...ROLES[0]),
    app: url(...ROLES[1]),
    platform: url(...ROLES[2]),
    readonly: url(...ROLES[3]),
  };
  await runMigrations(urls.owner);
  return {
    urls,
    async teardown() {
      await container.stop();
    },
  };
}

/** Provisions a migrated, empty database for one test run. Call `teardown()` afterwards. */
export async function provisionTestDatabase(): Promise<TestDatabase> {
  const admin = await connectShared();
  if (admin) return provisionShared(admin);
  return provisionContainer();
}
