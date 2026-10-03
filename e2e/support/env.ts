// Ports, hosts and connection strings shared by the Playwright config, the global setup and the
// journeys. Everything here is DEV/CI only: obviously-dev credentials, loopback addresses.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const API_PORT = process.env.E2E_API_PORT ?? '4000';
export const WEB_PORT = process.env.E2E_WEB_PORT ?? '3001';

/** Same lookup as scripts/lib.mjs: environment, else infra/docker/.env, else the default. */
function composePort(name: string, fallback: string): string {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  const envFile = resolve(repoRoot, 'infra/docker/.env');
  if (existsSync(envFile)) {
    const line = readFileSync(envFile, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`));
    const value = line?.slice(name.length + 1).trim();
    if (value) return value;
  }
  return fallback;
}

/** The API connects as `remix_app` (RLS enforced), exactly as in production. */
export const DATABASE_URL =
  process.env.DATABASE_URL ??
  `postgres://remix_app:remix_app_dev_password@127.0.0.1:${composePort('POSTGRES_PORT', '5432')}/remix`;

export type TenantSlug = 'kamalphysics' | 'royalscience' | 'closedacademy';

/** `http://<slug>.localhost:<port>`; Chromium resolves `*.localhost` to loopback by itself. */
export const origin = (slug: string): string => `http://${slug}.localhost:${WEB_PORT}`;
export const tenantUrl = (slug: string, path = '/'): string => `${origin(slug)}${path}`;
