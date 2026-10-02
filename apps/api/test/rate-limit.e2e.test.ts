import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectProblem } from './fixtures/problem';
import { createTestApp, HOST_A, HOST_B, type TestApp } from './fixtures/test-app';

describe('rate limiting (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ env: { TRUST_PROXY: 'loopback' } });
  });
  afterAll(() => t.close());

  const hit = (host: string, ip = '198.51.100.1') =>
    request(t.server).get('/api/v1/test/limited').set('Host', host).set('X-Forwarded-For', ip);

  it('allows `limit` requests per window, then 429 with Retry-After, then resets', async () => {
    expect((await hit(HOST_A)).status).toBe(200);
    expect((await hit(HOST_A)).status).toBe(200);

    const blocked = await hit(HOST_A);
    const problem = expectProblem(blocked, 429, 'RATE_LIMITED');
    expect(problem.title).toBe('Too many attempts. Try again later.');
    expect(blocked.headers['retry-after']).toBe('60');

    t.clock.now += 30_000;
    expect((await hit(HOST_A)).headers['retry-after']).toBe('30');

    t.clock.now += 30_000; // window over
    expect((await hit(HOST_A)).status).toBe(200);
  });

  it('counts per tenant: one institute cannot spend another institute’s budget', async () => {
    const ip = '198.51.100.2';
    await hit(HOST_A, ip);
    await hit(HOST_A, ip);
    expect((await hit(HOST_A, ip)).status).toBe(429);
    expect((await hit(HOST_B, ip)).status).toBe(200);
  });

  it('counts per client IP (from trusted X-Forwarded-For)', async () => {
    await hit(HOST_A, '198.51.100.3');
    await hit(HOST_A, '198.51.100.3');
    expect((await hit(HOST_A, '198.51.100.3')).status).toBe(429);
    expect((await hit(HOST_A, '198.51.100.4')).status).toBe(200);
  });

  it('counts an IPv6 client by its /64: rotating addresses in one prefix gains nothing (S-03)', async () => {
    await hit(HOST_A, '2001:db8:aaaa:1::1');
    await hit(HOST_A, '2001:db8:aaaa:1:dead:beef:0:2');
    expect((await hit(HOST_A, '2001:0db8:aaaa:0001:0:0:0:3')).status).toBe(429);
    expect((await hit(HOST_A, '2001:db8:aaaa:2::1')).status).toBe(200); // another /64
  });

  it('counts IPv4-mapped IPv6 as the IPv4 address (S-03)', async () => {
    await hit(HOST_A, '198.51.100.50');
    await hit(HOST_A, '::ffff:198.51.100.50');
    expect((await hit(HOST_A, '198.51.100.50')).status).toBe(429);
  });

  it('combines rules: a per-phone limit trips even when the IP changes', async () => {
    const login = (ip: string) =>
      request(t.server)
        .post('/api/v1/auth/student/login')
        .set('Host', HOST_A)
        .set('X-Forwarded-For', ip)
        .send({ phone: '0771112222', password: 'secret-pass' });
    for (const ip of ['192.0.2.1', '192.0.2.2', '192.0.2.3'])
      expect((await login(ip)).status).toBe(200);
    expectProblem(await login('192.0.2.4'), 429, 'RATE_LIMITED');
  });

  it('never skips a keyed rule whose extractor returns nothing (S-01)', async () => {
    // No usable phone → the extractor yields null. The rule must still count, in one fixed bucket.
    const bad = (ip: string) =>
      request(t.server)
        .post('/api/v1/auth/student/login')
        .set('Host', HOST_B)
        .set('X-Forwarded-For', ip)
        .send({ password: 'x' });
    for (const ip of ['192.0.2.11', '192.0.2.12', '192.0.2.13']) {
      expect((await bad(ip)).status).toBe(400);
    }
    expectProblem(await bad('192.0.2.14'), 429, 'RATE_LIMITED');
  });

  it('keys hold no phone numbers or IPs in clear, and always carry the tenant', () => {
    const keys = t.limiter.keys();
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).toMatch(/^t:[0-9a-f-]{36}:rl:[a-z-]+:[\w-]{32}$/);
      expect(key).not.toMatch(/0771112222|198\.51/);
    }
  });
});
