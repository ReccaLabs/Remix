import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/config';
import { createWorker } from '../src/worker.module';
import { LogCapture } from './fixtures/test-app';

describe('worker application context', () => {
  it('starts without an HTTP server and shuts down cleanly', async () => {
    const logs = new LogCapture();
    const app = await createWorker({
      config: loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'info' }),
      logDestination: logs,
    });
    expect(logs.text).toContain('Worker started');
    expect('getHttpServer' in app).toBe(false); // an application context, not an HTTP app
    await app.close();
    expect(logs.text).toContain('Worker stopped');
  });
});
