import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReadinessRegistry } from '../src/health/readiness';
import { createTestApp, type TestApp } from './fixtures/test-app';

describe('health endpoints (e2e)', () => {
  let t: TestApp;
  let healthy = true;
  beforeAll(async () => {
    t = await createTestApp();
    t.app.get(ReadinessRegistry).register({
      name: 'database',
      check: () => (healthy ? Promise.resolve() : Promise.reject(new Error('password=secret'))),
    });
  });
  afterAll(() => t.close());

  it('GET /health is public, on any host, outside /api/v1, with no tenant lookup', async () => {
    const lookups = t.tenants.lookups;
    const res = await request(t.server).get('/health').set('Host', 'whatever.example');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(t.tenants.lookups).toBe(lookups);
  });

  it('is not served under the API prefix', async () => {
    expect((await request(t.server).get('/api/v1/health')).status).toBe(404);
  });

  it('GET /health/ready aggregates checks: 200 when all pass', async () => {
    healthy = true;
    const res = await request(t.server).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'ok' } });
  });

  it('GET /health/ready is 503 when a check fails, without the failure details', async () => {
    healthy = false;
    const res = await request(t.server).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable', checks: { database: 'fail' } });
    expect(res.text).not.toContain('secret');
    healthy = true;
  });

  it('sends no version or server banner', async () => {
    const res = await request(t.server).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers.server).toBeUndefined();
  });

  it('sets API security headers', async () => {
    const res = await request(t.server).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });
});
