import { Controller, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API } from '@remix/types/api';
import { AppModule } from '../src/app.module';
import { Public } from '../src/common/auth/auth.decorators';
import { Endpoint, type EndpointResult } from '../src/common/validation/endpoint';
import { loadConfig } from '../src/config/config';
import { expectProblem } from './fixtures/problem';
import { createTestApp, HOST_A, TENANT_A, type TestApp } from './fixtures/test-app';
import { testState } from './fixtures/test.controller';

describe('@Endpoint request/response validation (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('binds the registry path and method, parses the body with the strict schema', async () => {
    const res = await request(t.server)
      .post(API.studentLogin.path)
      .set('Host', HOST_A)
      .send({ phone: '077 123 4567', password: 'secret-pass' });
    expect(res.status).toBe(200); // not Nest's default 201 for POST
    // The handler received the normalised phone (schema transform) and its result was validated.
    expect(res.body.user.displayName).toBe('+94771234567');
    expect(res.body.user.tenantId).toBe(TENANT_A.id);
  });

  it('rejects unknown fields with 400 and names them', async () => {
    const before = testState.loginCalls;
    const res = await request(t.server)
      .post(API.studentLogin.path)
      .set('Host', HOST_A)
      .send({ phone: '0771234567', password: 'secret-pass', role: 'owner' });
    const problem = expectProblem(res, 400, 'VALIDATION_FAILED');
    expect(problem.errors).toEqual([{ path: 'role', message: 'Unknown field' }]);
    expect(testState.loginCalls).toBe(before); // handler never ran
  });

  it('rejects a missing body', async () => {
    const res = await request(t.server)
      .post('/api/v1/test/echo')
      .set('Host', HOST_A)
      .set('Content-Type', 'application/json');
    expectProblem(res, 400, 'VALIDATION_FAILED');
  });

  it('strips fields the response contract does not declare', async () => {
    const res = await request(t.server).get('/api/v1/test/leaky').set('Host', HOST_A);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'abc' });
    expect(res.text).not.toContain('argon2');
  });

  it('turns a response that breaks its contract into a 500 and logs the contract bug', async () => {
    const res = await request(t.server).get('/api/v1/test/drift').set('Host', HOST_A);
    const problem = expectProblem(res, 500, 'INTERNAL');
    expect(res.text).not.toContain('not-a-uuid');
    const logged = t.logs.lines.find((l) => l.requestId === problem.requestId && l.err);
    expect(JSON.stringify(logged)).toContain('does not match its contract');
  });

  it('bodyless endpoints answer 204 and accept `{}` (what the typed client sends)', async () => {
    const res = await request(t.server).post('/api/v1/test/no-body').set('Host', HOST_A).send({});
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
  });

  it('bodyless endpoints reject a non-empty body', async () => {
    const res = await request(t.server)
      .post('/api/v1/test/no-body')
      .set('Host', HOST_A)
      .send({ anything: 1 });
    expectProblem(res, 400, 'VALIDATION_FAILED');
  });

  it('rejects JSON with a non-object top level for an object schema', async () => {
    const res = await request(t.server)
      .post('/api/v1/test/echo')
      .set('Host', HOST_A)
      .set('Content-Type', 'application/json')
      .send('"just a string"');
    // strict JSON parsing only accepts objects/arrays
    expectProblem(res, 400, 'VALIDATION_FAILED');
  });
});

describe('@Endpoint boot checks', () => {
  const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });

  async function boot(controller: new () => object): Promise<void> {
    @Module({ controllers: [controller] })
    class Feature {}
    const ref = await Test.createTestingModule({
      imports: [AppModule.forRoot({ config }), Feature],
    }).compile();
    const app = ref.createNestApplication({ bodyParser: false });
    try {
      await app.init();
    } finally {
      await app.close();
    }
  }

  it('refuses a controller prefix on @Endpoint controllers', async () => {
    @Controller('auth')
    class Prefixed {
      @Public()
      @Endpoint(API.logout)
      logout(): EndpointResult<typeof API.logout> {
        return undefined;
      }
    }
    await expect(boot(Prefixed)).rejects.toThrow(/must not set a path prefix/);
  });

  it('refuses binding one endpoint twice', async () => {
    @Controller()
    class Twice {
      @Public()
      @Endpoint(API.logout)
      a(): EndpointResult<typeof API.logout> {
        return undefined;
      }

      @Public()
      @Endpoint(API.logout)
      b(): EndpointResult<typeof API.logout> {
        return undefined;
      }
    }
    await expect(boot(Twice)).rejects.toThrow(/bound twice/);
  });
});
