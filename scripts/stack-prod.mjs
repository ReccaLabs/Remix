// pnpm stack:prod — local staging: the PRODUCTION Docker images of apps/web and apps/api running
// with the dev infra (Postgres, Valkey, Mailpit, S3), the same hosts as `pnpm dev`:
//   1. start the infra and wait until healthy (skips what already runs)
//   2. apply migrations and seed the dev tenants if there are none (from the host, like pnpm dev)
//   3. build the web + API images and start them
// `pnpm stack:prod:down` stops the web + API containers only (the infra may be shared with
// `pnpm dev`); `pnpm stack:prod:down --all` also stops the infra (`-v` wipes its volumes).
import { checkPorts, compose, composePort, fail, must, run, STACK_PORTS } from './lib.mjs';

const [action, ...rest] = process.argv.slice(2);

const info = await run('docker', ['info', '--format', '{{.ServerVersion}}'], {
  capture: true,
}).catch(() => ({ code: 1 }));
if (info.code !== 0) fail('Docker is not available. Install and start Docker, then retry.');

const webPort = composePort('WEB_PORT', '3001');
const apiPort = composePort('API_PORT', '4000');

if (action === 'down') {
  const all = rest.includes('--all');
  const flags = rest.filter((a) => a !== '--all');
  if (all) {
    await must(compose(['down', ...flags], { prod: true }), 'docker compose down failed.');
  } else {
    await must(
      compose(['rm', '--stop', '--force', 'web', 'api'], { prod: true }),
      'Could not stop the web and API containers.',
    );
    console.log('Stopped the web and API containers (infra left running; add --all to stop it).');
  }
} else {
  await checkPorts(
    [
      ...STACK_PORTS,
      { service: 'api', env: 'API_PORT', port: 4000, what: 'API' },
      { service: 'web', env: 'WEB_PORT', port: 3001, what: 'web app' },
    ],
    { prod: true },
  );
  console.log('Starting the infra (waiting for healthy services)...');
  await must(
    compose(
      ['up', '-d', '--wait', '--wait-timeout', '180', 'postgres', 'valkey', 'mailpit', 's3'],
      { prod: true },
    ),
    'The infra did not become healthy. Check: docker compose -f infra/docker/compose.yaml ps',
  );
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
    { prod: true, capture: true },
  );
  if (count.code !== 0 || Number(count.stdout.trim()) === 0) {
    console.log('No tenants yet, seeding dev data...');
    await must(run('node', ['scripts/db.mjs', 'seed']));
  }
  console.log(
    'Building the production images and starting web + API (first build takes minutes)...',
  );
  // One image build at a time: two parallel `pnpm install`s starve each other on a slow network.
  await must(
    compose(['up', '-d', '--build', '--wait', '--wait-timeout', '300', 'api', 'web'], {
      prod: true,
      env: { COMPOSE_PARALLEL_LIMIT: '1' },
    }),
    'The web/API images did not become healthy. Check: docker compose -f infra/docker/compose.yaml -f infra/docker/compose.prod.yaml logs api web',
  );
  console.log(
    `\nLocal staging is up: http://kamalphysics.localhost:${webPort} | admin http://admin.localhost:${webPort} | api http://localhost:${apiPort}\n` +
      'Stop it with: pnpm stack:prod:down\n',
  );
}
