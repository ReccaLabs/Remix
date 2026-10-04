// Capture the existing development mock SMS output for real-browser auth journeys.
// This launcher is test-only; production never selects the mock SMS provider.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
const log = createWriteStream(new URL('../mock-sms.log', import.meta.url), { flags: 'w' });
const child = spawn(process.execPath, ['--enable-source-maps', 'apps/api/dist/main.js'], {
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (data) => {
  log.write(data);
  process.stdout.write(data);
});
child.stderr.on('data', (data) => {
  log.write(data);
  process.stderr.write(data);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code) => {
  log.end();
  process.exitCode = code ?? 1;
});
