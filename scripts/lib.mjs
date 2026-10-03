// Shared helpers for the local-dev scripts. Plain Node (no dependencies) so they run the same in
// Git Bash / PowerShell on Windows and on Linux CI. Everything here is DEV ONLY.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const composeFile = resolve(root, 'infra/docker/compose.yaml');
export const composeProdFile = resolve(root, 'infra/docker/compose.prod.yaml');

/** Host port of a compose service: environment, else infra/docker/.env, else the default. */
export function composePort(name, fallback) {
  if (process.env[name]) return process.env[name];
  const envFile = resolve(root, 'infra/docker/.env');
  if (existsSync(envFile)) {
    const line = readFileSync(envFile, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`));
    const value = line?.slice(name.length + 1).trim();
    if (value) return value;
  }
  return fallback;
}

/** Dev connection strings, matching infra/docker/postgres/init and packages/db/.env.example. */
export function devDatabaseUrls() {
  const port = composePort('POSTGRES_PORT', '5432');
  const url = (role) => `postgres://${role}:${role}_dev_password@127.0.0.1:${port}/remix`;
  return { owner: url('remix_owner'), app: url('remix_app') };
}

/**
 * Runs a command and resolves with `{ code, stdout }`. Stdio is inherited unless `capture` is
 * set. `pnpm` is launched through the running pnpm (`npm_execpath`) so no shell is needed on
 * Windows, where pnpm is a .cmd shim.
 */
export function run(command, args, { env, capture = false } = {}) {
  let cmd = command;
  let argv = args;
  let shell = false;
  if (command === 'pnpm') {
    const execPath = process.env.npm_execpath;
    if (execPath && /\.[cm]?js$/.test(execPath)) {
      cmd = process.execPath;
      argv = [execPath, ...args];
    } else {
      shell = true;
      cmd = ['pnpm', ...args].join(' ');
      argv = [];
    }
  }
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, argv, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      shell,
    });
    let stdout = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code: code ?? 1, stdout }));
  });
}

/** `docker compose` against the dev stack; `prod` adds the local-staging overlay (web + API images). */
export function compose(args, options = {}) {
  const { prod = false, ...runOptions } = options;
  const files = prod ? [composeFile, composeProdFile] : [composeFile];
  return run('docker', ['compose', ...files.flatMap((f) => ['-f', f]), ...args], runOptions);
}

/** True when nothing holds or reserves 127.0.0.1:port (where Docker publishes). */
function portIsFree(port) {
  return new Promise((done) => {
    const server = createServer();
    server.once('error', () => done(false));
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () =>
      server.close(() => done(true)),
    );
  });
}

/**
 * Stops with a clear message when a host port a not-yet-running service needs is taken, instead
 * of Docker's generic "not healthy" / "ports are not available". `needs` lists
 * `{ service, env, port, what }`; services that already run keep their ports and are skipped.
 */
export async function checkPorts(needs, options = {}) {
  const running = await compose(['ps', '--services', '--status', 'running'], {
    ...options,
    capture: true,
  });
  const up = new Set(running.stdout.split(/\r?\n/).filter(Boolean));
  const problems = [];
  for (const { service, env, port, what } of needs) {
    if (up.has(service)) continue;
    const number = Number(composePort(env, String(port)));
    if (await portIsFree(number)) continue;
    problems.push(
      `  - port ${number} (${what}) is in use or reserved. Find the owner:  netstat -ano | findstr :${number}\n` +
        `    then stop that program, or move ${what} by setting ${env}=<free port> in infra/docker/.env`,
    );
  }
  if (problems.length === 0) return;
  fail(
    `Cannot start the stack, these host ports are not available:\n${problems.join('\n')}\n\n` +
      'On Windows a port can also be reserved by Hyper-V/WSL while no program uses it; check\n' +
      '  netstat -ano | findstr :<port>   and   netsh interface ipv4 show excludedportrange protocol=tcp\n' +
      'then pick another port in infra/docker/.env (copy infra/docker/.env.example).',
  );
}

/** Host ports the dev stack publishes. */
export const STACK_PORTS = [
  { service: 'postgres', env: 'POSTGRES_PORT', port: 5432, what: 'Postgres' },
  { service: 'valkey', env: 'VALKEY_PORT', port: 6379, what: 'Valkey' },
  { service: 'mailpit', env: 'MAILPIT_SMTP_PORT', port: 1025, what: 'Mailpit SMTP' },
  { service: 'mailpit', env: 'MAILPIT_UI_PORT', port: 8025, what: 'Mailpit UI' },
  { service: 's3', env: 'S3_PORT', port: 8333, what: 'S3 storage' },
];

export function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/** Exits with `message` if the command failed; returns its captured stdout otherwise. */
export async function must(promise, message) {
  const { code, stdout } = await promise;
  if (code !== 0) fail(message ?? `Command failed with exit code ${code}.`);
  return stdout;
}
