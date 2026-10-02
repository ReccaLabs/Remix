import { Body, Controller, ForbiddenException, Get, Post } from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { API, type EndpointDef } from '@remix/types/api';
import {
  CurrentSession,
  CurrentTenant,
  Public,
  Roles,
} from '../../src/common/auth/auth.decorators';
import type { AuthSession } from '../../src/common/auth/session-authenticator';
import { requireContext, type RequestContext } from '../../src/common/context/request-context';
import { AppException } from '../../src/common/errors/app-exception';
import { RateLimit } from '../../src/common/rate-limit/rate-limit.guard';
import { SkipCsrf } from '../../src/common/security/csrf.guard';
import { HostScope } from '../../src/common/tenant/tenant.guard';
import type { ResolvedTenant } from '../../src/common/tenant/tenant-resolver';
import {
  Endpoint,
  type EndpointBody,
  type EndpointResult,
} from '../../src/common/validation/endpoint';

/** Test-only contracts, shaped like the real registry. */
export const TEST_API = {
  echo: {
    method: 'POST',
    path: '/api/v1/test/echo',
    request: z.strictObject({ name: z.string().min(1).max(20), age: z.number().int().optional() }),
    response: z.object({ greeting: z.string() }),
  },
  leaky: {
    method: 'GET',
    path: '/api/v1/test/leaky',
    response: z.object({ id: z.string() }),
  },
  drift: {
    method: 'GET',
    path: '/api/v1/test/drift',
    response: z.object({ id: z.uuid() }),
  },
  noBody: { method: 'POST', path: '/api/v1/test/no-body' },
} as const satisfies Record<string, EndpointDef>;

/** Mutable knobs the e2e tests flip. */
export const testState = { loginCalls: 0 };

const SAMPLE_USER_ID = '0199a1b2-c3d4-7e5f-8a9b-1c1d2e3f4a5b';

@Controller()
export class TestController {
  constructor(@InjectPinoLogger('TestController') private readonly logger: PinoLogger) {}

  /** A real registry endpoint: strict body, normalised phone, response through its schema. */
  @Public()
  @Endpoint(API.studentLogin)
  @RateLimit(
    {
      name: 'login-phone',
      limit: 3,
      windowSec: 60,
      by: (req) => {
        const body: unknown = req.body;
        return body && typeof body === 'object' && 'phone' in body && typeof body.phone === 'string'
          ? body.phone
          : null;
      },
    },
    { name: 'login-ip', limit: 10, windowSec: 60, by: 'ip' },
  )
  login(
    @Body() body: EndpointBody<typeof API.studentLogin>,
    @CurrentTenant() tenant: ResolvedTenant,
  ): EndpointResult<typeof API.studentLogin> {
    testState.loginCalls += 1;
    return {
      user: {
        id: SAMPLE_USER_ID,
        tenantId: tenant.id,
        kind: 'student',
        displayName: body.phone,
        roles: [],
        locale: 'en',
      },
      expiresAt: '2026-11-01T00:00:00.000Z',
      impersonated: false,
    };
  }

  @Public({ optionalSession: true })
  @Endpoint(API.logout)
  logout(): EndpointResult<typeof API.logout> {
    return undefined;
  }

  @Endpoint(API.session)
  session(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
  ): EndpointResult<typeof API.session> {
    return {
      user: {
        id: session.userId,
        tenantId: tenant.id,
        kind: 'student',
        displayName: 'Sample Student',
        roles: [],
        locale: 'en',
      },
      expiresAt: '2026-11-01T00:00:00.000Z',
      impersonated: false,
    };
  }

  @Public()
  @Endpoint(TEST_API.echo)
  echo(@Body() body: EndpointBody<typeof TEST_API.echo>): EndpointResult<typeof TEST_API.echo> {
    return { greeting: `Hello ${body.name}` };
  }

  @Public()
  @Endpoint(TEST_API.leaky)
  leaky(): EndpointResult<typeof TEST_API.leaky> {
    const row = { id: 'abc', passwordHash: '$argon2id$secret' };
    return row;
  }

  @Public()
  @Endpoint(TEST_API.drift)
  drift(): EndpointResult<typeof TEST_API.drift> {
    return { id: 'not-a-uuid' };
  }

  @Public()
  @Endpoint(TEST_API.noBody)
  noBody(): EndpointResult<typeof TEST_API.noBody> {
    return undefined;
  }

  @Public()
  @Get('test/boom')
  boom(): never {
    throw new Error('connect ECONNREFUSED; SELECT password FROM users WHERE phone=+94771234567');
  }

  /** What a failed insert looks like: SQL + bound params (phone, hash) + the Postgres error. */
  @Public()
  @Get('test/db-boom')
  dbBoom(): never {
    throw new DrizzleQueryError(
      'insert into "tenant_users" ("phone", "password_hash") values ($1, $2)',
      ['+94771234567', '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2g'],
      Object.assign(new Error('duplicate key value violates unique constraint "x"'), {
        code: '23505',
        detail: 'Key (phone)=(+94771234567) already exists.',
      }),
    );
  }

  @Public()
  @Get('test/forbidden-http')
  forbiddenHttp(): never {
    throw new ForbiddenException('internal reason: user 42 lacks flag x');
  }

  @Public()
  @Get('test/conflict')
  conflict(): never {
    throw new AppException('CONFLICT', 409, 'Already enrolled', {
      detail: 'This student is already in the class.',
    });
  }

  @Get('test/owner-only')
  @Roles('owner', 'admin')
  ownerOnly(): { ok: true } {
    return { ok: true };
  }

  @Get('test/me')
  me(@CurrentSession() session: AuthSession): { userId: string } {
    this.logger.info('handling /test/me');
    return { userId: session.userId };
  }

  @Public()
  @Get('test/limited')
  @RateLimit({ name: 'limited', limit: 2, windowSec: 60, by: 'ip' })
  limited(): { ok: true } {
    return { ok: true };
  }

  @Public()
  @Get('test/log')
  log(): { ok: true } {
    this.logger.info({ password: 'hunter2', nested: { token: 't0ken' } }, 'handled');
    return { ok: true };
  }

  /** What the API believes about the request (host-independent, for forwarding tests). */
  @Public()
  @HostScope('any')
  @Get('test/whoami')
  whoami(): Pick<RequestContext, 'host' | 'protocol' | 'origin' | 'clientIp' | 'requestId'> {
    const { host, protocol, origin, clientIp, requestId } = requireContext();
    return { host, protocol, origin, clientIp, requestId };
  }

  @Public()
  @HostScope('platform')
  @Get('platform/ping')
  platformPing(): { area: 'platform' } {
    return { area: 'platform' };
  }

  /** Webhooks: no CSRF guard, no session, form bodies allowed (signature-checked later). */
  @Public()
  @SkipCsrf()
  @Post('webhooks/test')
  webhook(): { received: true } {
    return { received: true };
  }
}
