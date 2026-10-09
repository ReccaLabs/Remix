import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import type { Redis } from 'ioredis';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { AuthGuard } from './common/auth/auth.guard';
import { PermissionGuard } from './common/auth/permission.guard';
import { RolesGuard } from './common/auth/roles.guard';
import {
  NullSessionAuthenticator,
  SESSION_AUTHENTICATOR,
} from './common/auth/session-authenticator';
import { ProblemFilter } from './common/errors/problem.filter';
import { loggerParams } from './common/logging/logger';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
import { InMemoryRateLimiter, RATE_LIMITER } from './common/rate-limit/rate-limiter';
import { ValkeyRateLimiter } from './common/rate-limit/valkey-rate-limiter';
import { VALKEY, ValkeyModule } from './common/valkey/valkey';
import { CsrfGuard } from './common/security/csrf.guard';
import { TenantAccessGuard } from './common/tenant/tenant-access.guard';
import { TenantGuard } from './common/tenant/tenant.guard';
import { NullTenantResolver, TENANT_RESOLVER } from './common/tenant/tenant-resolver';
import { CLOCK, systemClock } from './common/time/clock';
import { EndpointInterceptor } from './common/validation/endpoint.interceptor';
import { EndpointVerifier } from './common/validation/endpoint-verifier';
import { APP_CONFIG, type AppConfig } from './config/config';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { AuthModule } from './modules/auth/auth.module';
import { DbSessionAuthenticator } from './modules/auth/db-session-authenticator';
import { ClassesModule } from './modules/classes/classes.module';
import { DbModule } from './modules/db/db.module';
import { ImportsModule } from './modules/imports/imports.module';
import { PeopleModule } from './modules/people/people.module';
import { FeesModule } from './modules/fees/fees.module';
import { SlipsModule } from './modules/slips/slips.module';
import { StorageModule } from './integrations/storage/storage.module';
import { DbTenantResolver } from './modules/tenancy/db-tenant-resolver';
import { TenancyModule } from './modules/tenancy/tenancy.module';

export interface AppModuleOptions {
  config: AppConfig;
  /** Where JSON logs go (stdout by default; tests capture them). */
  logDestination?: DestinationStream;
  /**
   * Wire the database-backed modules (tenancy, auth, classes) and bind the extension points to
   * them. On by default — the API never runs without them; `DATABASE_URL` is then required.
   * Only the core-pipeline tests turn it off and use the in-memory doubles.
   */
  database?: boolean;
}

/**
 * Cross-cutting infrastructure shared by every module: config, logging, and the extension
 * points business modules implement. Global, so feature modules can inject the tokens.
 */
@Global()
@Module({})
class CoreModule {
  static forRoot({ config, logDestination, database = true }: AppModuleOptions): DynamicModule {
    return {
      module: CoreModule,
      imports: [
        LoggerModule.forRoot(loggerParams(config, logDestination)),
        DiscoveryModule,
        ...(config.valkeyUrl ? [ValkeyModule.forRoot(config)] : []),
      ],
      providers: [
        { provide: APP_CONFIG, useValue: config },

        // ── Extension points ─────────────────────────────────────────────────────────────
        // With the database: host → tenant from Postgres (TEN-01) and opaque sessions (ADR
        // 0004), provided by the global TenancyModule/AuthModule. Without it (core-pipeline
        // tests only): nobody resolves, nobody is signed in. The limiter is in-memory until
        // the Valkey module lands; tests override any of these with in-memory doubles.
        database
          ? { provide: TENANT_RESOLVER, useExisting: DbTenantResolver }
          : { provide: TENANT_RESOLVER, useClass: NullTenantResolver },
        database
          ? { provide: SESSION_AUTHENTICATOR, useExisting: DbSessionAuthenticator }
          : { provide: SESSION_AUTHENTICATOR, useClass: NullSessionAuthenticator },
        // Valkey limiter when VALKEY_URL is set (required in production, C6); the in-memory one
        // only for development without Valkey and for tests.
        config.valkeyUrl
          ? {
              provide: RATE_LIMITER,
              useFactory: (client: Redis) => new ValkeyRateLimiter(client),
              inject: [VALKEY],
            }
          : { provide: RATE_LIMITER, useFactory: () => new InMemoryRateLimiter() },
        { provide: CLOCK, useValue: systemClock },

        // ── Request pipeline ─────────────────────────────────────────────────────────────
        // Global guards run in this order: CSRF before anything reads the cookie, then the
        // tenant (so auth can check the session belongs to it), then auth (deny by default),
        // then the tenant's status vs the session (TEN-06), then rate limits (keyed by
        // tenant/user), then roles.
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useClass: TenantGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: TenantAccessGuard },
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
        { provide: APP_INTERCEPTOR, useClass: EndpointInterceptor },
        { provide: APP_FILTER, useClass: ProblemFilter },
        EndpointVerifier,
      ],
      exports: [APP_CONFIG, TENANT_RESOLVER, SESSION_AUTHENTICATOR, RATE_LIMITER, CLOCK],
    };
  }
}

/** Root module of the HTTP API. Feature modules are added to `imports`. */
@Module({})
export class AppModule {
  static forRoot(options: AppModuleOptions): DynamicModule {
    const database = options.database ?? true;
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot({ ...options, database }),
        HealthModule,
        JobsModule.forRoot(options.config),
        StorageModule.forRoot(options.config),
        ...(database
          ? [
              DbModule.forRoot(options.config),
              TenancyModule,
              AuthModule,
              ClassesModule,
              PeopleModule,
              ImportsModule,
              FeesModule,
              SlipsModule,
            ]
          : []),
      ],
    };
  }
}
