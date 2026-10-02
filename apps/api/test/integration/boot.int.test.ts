import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Db } from '@remix/db';
import { tenantPublicSchema } from '@remix/types/api';
import { ConfigError, loadConfig } from '../../src/config/config';
import { expectProblem } from '../fixtures/problem';
import { client, createDbTestApp, Factory, ownerDb, type DbTestApp } from './support/db-app';

describe('database wiring', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;

  beforeAll(async () => {
    t = await createDbTestApp();
    db = ownerDb();
    f = new Factory(db);
  });
  afterAll(async () => {
    await t.close();
    await db.$client.end();
  });

  it('readiness reports the database', async () => {
    const res = await request(t.server).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'ok' } });
  });

  it('GET /api/v1/tenant returns the public record for any status; unknown host 404', async () => {
    for (const status of ['active', 'suspended', 'cancelled'] as const) {
      const tenant = await f.tenant(status);
      const res = await client(t, tenant.host).get('/api/v1/tenant');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = tenantPublicSchema.strict().parse(res.body);
      expect(body).toMatchObject({
        id: tenant.id,
        slug: tenant.slug,
        status,
        timezone: 'Asia/Colombo',
      });
    }
    expectProblem(
      await client(t, 'nobody.remix.lk').get('/api/v1/tenant'),
      404,
      'TENANT_NOT_FOUND',
    );
    expectProblem(await client(t, 'admin.remix.lk').get('/api/v1/tenant'), 404, 'NOT_FOUND');
  });

  it('caches host → tenant for 60 s', async () => {
    const tenant = await f.tenant('active');
    await client(t, tenant.host).get('/api/v1/tenant');
    await f.setTenantStatus(tenant, 'suspended');
    expect((await client(t, tenant.host).get('/api/v1/tenant')).body.status).toBe('active');
    t.clock.advance(60_000);
    expect((await client(t, tenant.host).get('/api/v1/tenant')).body.status).toBe('suspended');
  });

  it('refuses to start as a role that bypasses RLS (the owner)', async () => {
    await expect(createDbTestApp({ DATABASE_URL: inject('dbUrls').owner })).rejects.toThrow(
      /not RLS-bound/,
    );
  });

  it('requires DATABASE_URL when the database modules are on', () => {
    expect(() => loadConfig({ NODE_ENV: 'test' }, { requireDatabase: true })).toThrow(ConfigError);
  });
});
