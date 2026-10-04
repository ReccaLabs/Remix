import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { API_PORT, WEB_PORT, repoRoot } from './support/env';

/**
 * Fails early, with the command that fixes it, when the stack is not what the journeys assume:
 * the API answers, the database is migrated and seeded with the three dev tenants, and the web
 * app was built with the /api/v1 rewrite. Runs after the web servers in `webServer` are up.
 */

const SETUP_HINT =
  'Bring the stack up first:\n' +
  '  pnpm dev:stack && pnpm db:migrate && pnpm db:seed\n' +
  '  WEB_API_REWRITE=true pnpm --filter @remix/api --filter @remix/web build\n' +
  'See e2e/README.md.';

async function tenantFromApi(slug: string): Promise<{ status: number; body: unknown }> {
  // Act as the web server would: loopback peer plus the forwarded tenant host.
  const res = await fetch(`http://127.0.0.1:${API_PORT}/api/v1/tenant`, {
    headers: { 'x-forwarded-host': `${slug}.localhost` },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export default async function globalSetup(): Promise<void | (() => Promise<void>)> {
  const expected = [
    ['kamalphysics', 'active'],
    ['royalscience', 'active'],
    ['closedacademy', 'suspended'],
  ] as const;

  for (const [slug, status] of expected) {
    let result: { status: number; body: unknown };
    try {
      result = await tenantFromApi(slug);
    } catch (err) {
      throw new Error(
        `The API on port ${API_PORT} is not reachable (${String(err)}).\n${SETUP_HINT}`,
        {
          cause: err,
        },
      );
    }
    const body = result.body as { status?: string } | null;
    if (result.status !== 200) {
      throw new Error(
        `The API does not know the tenant "${slug}" (HTTP ${result.status}). ` +
          `The database is probably not migrated or seeded.\n${SETUP_HINT}`,
      );
    }
    if (body?.status !== status) {
      throw new Error(
        `Tenant "${slug}" has status "${String(body?.status)}", expected "${status}". ` +
          `Re-seed the database: pnpm db:seed`,
      );
    }
  }

  // The browser reaches the API only through the web app's same-origin /api/v1 rewrite. With an
  // IP host the API answers 404 problem+json (unknown tenant); without the rewrite Next answers
  // with an HTML 404.
  const viaWeb = await fetch(`http://127.0.0.1:${WEB_PORT}/api/v1/tenant`);
  if (!(viaWeb.headers.get('content-type') ?? '').includes('json')) {
    throw new Error(
      `The web app has no /api/v1 rewrite to the API. Rebuild it with WEB_API_REWRITE=true.
${SETUP_HINT}`,
    );
  }
  if (process.env.E2E_EXTERNAL_STACK === 'true') {
    // Local staging uses the same dev logging mock, inside the production API image.
    const log = createWriteStream(resolve(repoRoot, 'e2e/mock-sms.log'), { flags: 'w' });
    const logs = spawn(
      'docker',
      ['logs', '--follow', '--since', '1s', process.env.E2E_API_CONTAINER ?? 'remix-api-1'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    logs.stdout.pipe(log);
    logs.stderr.pipe(log, { end: false });
    return async () => {
      const stopped = once(logs, 'exit');
      logs.kill();
      await stopped;
      log.end();
    };
  }
}
