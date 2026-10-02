import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { AuthGuard } from './common/auth/auth.guard';
import { RolesGuard } from './common/auth/roles.guard';
import {
  NullSessionAuthenticator,
  SESSION_AUTHENTICATOR,
} from './common/auth/session-authenticator';
import { ProblemFilter } from './common/errors/problem.filter';
import { loggerParams } from './common/logging/logger';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
import { InMemoryRateLimiter, RATE_LIMITER } from './common/rate-limit/rate-limiter';
import { CsrfGuard } from './common/security/csrf.guard';
import { TenantGuard } from './common/tenant/tenant.guard';
import { NullTenantResolver, TENANT_RESOLVER } from './common/tenant/tenant-resolver';
import { EndpointInterceptor } from './common/validation/endpoint.interceptor';
import { EndpointVerifier } from './common/validation/endpoint-verifier';
import { APP_CONFIG, type AppConfig } from './config/config';
import { HealthModule } from './health/health.module';

export interface AppModuleOptions {
  config: AppConfig;
  /** Where JSON logs go (stdout by default; tests capture them). */
  logDestination?: DestinationStream;
}

/**
 * Cross-cutting infrastructure shared by every module: config, logging, and the extension
 * points business modules implement. Global, so feature modules can inject the tokens.
 */
@Global()
@Module({})
class CoreModule {
  static forRoot({ config, logDestination }: AppModuleOptions): DynamicModule {
    return {
      module: CoreModule,
      imports: [LoggerModule.forRoot(loggerParams(config, logDestination)), DiscoveryModule],
      providers: [
        { provide: APP_CONFIG, useValue: config },

        // ── Extension points ─────────────────────────────────────────────────────────────
        // Track E swaps these defaults for the database-backed implementations (TEN-01,
        // AUTH-01/05) and the Valkey limiter; tests override them with in-memory doubles.
        { provide: TENANT_RESOLVER, useClass: NullTenantResolver },
        { provide: SESSION_AUTHENTICATOR, useClass: NullSessionAuthenticator },
        { provide: RATE_LIMITER, useFactory: () => new InMemoryRateLimiter() },

        // ── Request pipeline ─────────────────────────────────────────────────────────────
        // Global guards run in this order: CSRF before anything reads the cookie, then the
        // tenant (so auth can check the session belongs to it), then auth (deny by default),
        // then rate limits (keyed by tenant/user), then roles.
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useClass: TenantGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_INTERCEPTOR, useClass: EndpointInterceptor },
        { provide: APP_FILTER, useClass: ProblemFilter },
        EndpointVerifier,
      ],
      exports: [APP_CONFIG, TENANT_RESOLVER, SESSION_AUTHENTICATOR, RATE_LIMITER],
    };
  }
}

/** Root module of the HTTP API. Feature modules (Track E onwards) are added to `imports`. */
@Module({})
export class AppModule {
  static forRoot(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.forRoot(options), HealthModule],
    };
  }
}
