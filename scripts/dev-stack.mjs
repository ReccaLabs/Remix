// pnpm dev:stack — start the local infra (Postgres 18, Valkey, Mailpit, S3) detached and wait
// until every healthcheck passes. Idempotent: re-running with the stack up is a no-op.
// `pnpm dev:stack down` stops it (data is kept; `pnpm dev:stack down -v` wipes the volumes).
import { compose, fail, must, run } from './lib.mjs';

const [action, ...rest] = process.argv.slice(2);

const info = await run('docker', ['info', '--format', '{{.ServerVersion}}'], {
  capture: true,
}).catch(() => ({ code: 1 }));
if (info.code !== 0) fail('Docker is not available. Install and start Docker, then retry.');

if (action === 'down') {
  await must(compose(['down', ...rest]), 'docker compose down failed.');
} else {
  console.log('Starting the dev stack (waiting for healthy services)...');
  await must(
    compose(['up', '-d', '--wait', '--wait-timeout', '180']),
    'The dev stack did not become healthy. Check: docker compose -f infra/docker/compose.yaml ps',
  );
  console.log('Dev stack is up: Postgres, Valkey, Mailpit, S3 (ports: infra/docker/compose.yaml).');
}
