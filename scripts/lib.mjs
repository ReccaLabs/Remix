// Shared helpers for the local-dev scripts. Plain Node (no dependencies) so they run the same in
// Git Bash / PowerShell on Windows and on Linux CI. Everything here is DEV ONLY.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const composeFile = resolve(root, 'infra/docker/compose.yaml');

/** Host port of a compose service: environment, else infra/docker/.env, else the default. */
function composePort(name, fallback) {
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

export function compose(args, options) {
  return run('docker', ['compose', '-f', composeFile, ...args], options);
}

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
