import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '@remix/db';

/** Same image family as infra/docker/compose.yaml. */
const IMAGE = 'postgres:18-alpine';
const SUPERUSER_PASSWORD = 'test-only-superuser';

/**
 * Cluster roles as production expects them (packages/db README → "Production roles"), exactly
 * like packages/db/test/global-setup.ts. Ephemeral container on a random local port, so fixed
 * test-only passwords are fine. Literal statements — keep BOOTSTRAP and the URLs in sync.
 */
const BOOTSTRAP = [
  "CREATE ROLE remix_owner LOGIN PASSWORD 'test-only-owner' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT",
  "CREATE ROLE remix_app LOGIN PASSWORD 'test-only-app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT",
  "CREATE ROLE remix_platform LOGIN PASSWORD 'test-only-platform' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT",
  "CREATE ROLE remix_readonly LOGIN PASSWORD 'test-only-readonly' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT",
  "ALTER ROLE remix_owner SET timezone = 'UTC'",
  "ALTER ROLE remix_app SET timezone = 'UTC'",
  "ALTER ROLE remix_platform SET timezone = 'UTC'",
  "ALTER ROLE remix_readonly SET timezone = 'UTC'",
  'CREATE DATABASE remix OWNER remix_owner',
];

declare module 'vitest' {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string };
  }
}

let container: StartedPostgreSqlContainer | undefined;

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  container = await new PostgreSqlContainer(IMAGE)
    .withDatabase('postgres')
    .withUsername('postgres')
    .withPassword(SUPERUSER_PASSWORD)
    .start();

  const host = container.getHost();
  const port = container.getPort();
  const url = (user: string, password: string, database = 'remix') =>
    `postgres://${user}:${password}@${host}:${port}/${database}`;

  const superuser = new pg.Client({
    connectionString: url('postgres', SUPERUSER_PASSWORD, 'postgres'),
  });
  await superuser.connect();
  try {
    for (const statement of BOOTSTRAP) await superuser.query(statement);
  } finally {
    await superuser.end();
  }

  const owner = url('remix_owner', 'test-only-owner');
  await runMigrations(owner);
  project.provide('dbUrls', { owner, app: url('remix_app', 'test-only-app') });

  return async () => {
    await container?.stop();
  };
}
