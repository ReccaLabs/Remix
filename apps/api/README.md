# apps/api — NestJS API and worker

NestJS 11 (Express) modular monolith. The browser always calls it **same-origin** at `/api/v1/*` on the host it is on. The edge proxy routes that path here, so there is **no CORS and no CORS allow-list** ([ADR 0003](../../docs/decisions/0003-same-origin-api-via-edge-proxy.md)). `apps/web` calls it server-side with the typed client ([ADR 0006](../../docs/decisions/0006-web-api-data-access.md)). Contracts come from `@remix/types/api`. Rules: [DEVELOPMENT.md §4.1 and §5](../../DEVELOPMENT.md).

**Status:** core infrastructure (Track C). Tenant resolution with the database, login/sessions and business modules come next (Track E) through the extension points below.

## Commands

```bash
pnpm --filter @remix/api dev         # tsdown --watch, restarts node on :4000
pnpm --filter @remix/api build       # → dist/main.js (API) + dist/worker.js (worker)
pnpm --filter @remix/api start       # node dist/main.js
pnpm --filter @remix/api start:worker
pnpm --filter @remix/api test        # Vitest: unit (src/**/*.test.ts) + e2e (test/*.e2e.test.ts)
pnpm --filter @remix/api lint        # ESLint (typescript-eslint strict-type-checked)
pnpm --filter @remix/api typecheck
docker build -f apps/api/Dockerfile -t remix-api .   # from the repo root
```

**Build:** [tsdown](https://tsdown.dev) (rolldown + oxc) bundles `src/main.ts` and `src/worker.ts` to ESM. Nest DI needs legacy decorators with `emitDecoratorMetadata`. oxc emits them from `tsconfig.json`, and Vitest uses the same oxc transform through Vite. One transformer and one config source serve build, dev and tests (`test/decorator-metadata.test.ts` guards this). Workspace packages export raw `.ts`, so `@remix/*` is bundled. Everything else stays external and is installed in the image with `pnpm deploy --prod`.

## Environment

Validated with Zod at boot ([`src/config/config.ts`](src/config/config.ts)). An invalid value stops the process and prints variable names, never values. See [`.env.example`](.env.example).

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `PORT` | `4000` | |
| `LOG_LEVEL` | `info` | pino levels, `silent` |
| `TRUST_PROXY` | `loopback` | IPs/CIDRs/`loopback`/`linklocal`/`uniquelocal`/`none`. Only these peers' `X-Forwarded-Host/-Proto/-For` are believed |
| `TENANT_BASE_DOMAINS` | `localhost` | `remix.lk` in prod (localhost rejected in production) |
| `PLATFORM_HOSTS` | `admin.localhost` | `admin.remix.lk` in prod |
| `COOKIE_SECURE` | `true` in production | must be `true` in production |
| `DATABASE_URL` | — | optional until the DB module lands |

## Request pipeline

```
request-context middleware   requestId (x-request-id), host/proto/origin/client IP from trusted forwarding only, AsyncLocalStorage
helmet                       CSP default-src 'none'; frame-ancestors 'none', nosniff, DENY, no-referrer (HSTS in prod)
JSON body parser             application/json only, 100 kb, strict; errors → problem+json (400/413/415)
pino-http (nestjs-pino)      one JSON line per request: requestId, tenantId, userId, method, path, status
guards (global, in order)    CsrfGuard → TenantGuard → AuthGuard → RateLimitGuard → RolesGuard
EndpointInterceptor          strict request parse / response serialisation for @Endpoint routes
ProblemFilter                every error → RFC 9457 application/problem+json
```

- **CSRF (ADR 0003):** on POST/PUT/PATCH/DELETE the guard checks `Sec-Fetch-Site` (only `same-origin`/`none`) and `Origin` (must equal the request's own scheme://host:port; `null` is rejected), and returns 403 `CSRF_REJECTED`. `Content-Type: application/json` is required on **every** unsafe request, bodyless ones included (the typed client sends `{}`); otherwise 415 `CSRF_REJECTED`. Requests without `Origin` and `Sec-Fetch-Site` are server-to-server and pass the header checks. Webhooks opt out with `@SkipCsrf()`.
- **Host scope:** routes are tenant-scoped by default. `@HostScope('platform')` serves only on `PLATFORM_HOSTS`, and `@HostScope('any')` is for health. A route on the wrong kind of host returns 404. An unknown tenant host returns 404 `TENANT_NOT_FOUND`.
- **Deny by default:** every route needs a session unless it is marked `@Public()`. A session only counts on the host it belongs to: a tenant-A cookie on tenant B's host, or a tenant session on the admin host, is treated as no session. `@Roles('owner', …)` adds role checks (403 `FORBIDDEN`). RLS repeats them in the database.
- **Errors:** throw `new AppException(code, status, title?, { detail?, errors?, headers? })`. Zod errors become 400 `VALIDATION_FAILED` with dot paths. Nest `HttpException`s keep only their status. Anything else becomes a generic 500 `INTERNAL`, and its stack is logged server-side only.
- **Logs:** JSON lines that carry `requestId`, `tenantId` and `userId`. No headers, query strings, bodies or IPs. Secret-looking fields (`password`, `token`, `cookie`, `authorization`, …) are redacted.

## Extension points (Track E)

Default bindings live in [`src/app.module.ts`](src/app.module.ts) (`CoreModule`, "Extension points"). Swap a default by changing its provider there, for example `{ provide: TENANT_RESOLVER, useExisting: DbTenantResolver }` with the DB module imported.

| Token | Interface | Default now | Implement with |
| --- | --- | --- | --- |
| `TENANT_RESOLVER` | `TenantResolver.resolve(host) → ResolvedTenant \| null` | `NullTenantResolver` (every host 404) | `resolveTenantByHost` from `@remix/db` + Valkey cache |
| `SESSION_AUTHENTICATOR` | `SessionAuthenticator.authenticate({ req, res, tenant }) → AuthSession \| null` | `NullSessionAuthenticator` (every protected route 401) | session cookie → SHA-256 lookup (ADR 0004) |
| `RATE_LIMITER` | `RateLimiter.consume(key, limit, windowSec)` | `InMemoryRateLimiter` | Valkey `INCR`/`EXPIRE` |
| `PAYMENT_PROVIDER`, `SMS_PROVIDER`, `VIDEO_PROVIDER`, `MEETING_PROVIDER`, `STORAGE_PROVIDER`, `EMAIL_PROVIDER` | `src/integrations/<kind>/<kind>.provider.ts` | unbound in `AppModule`; `MockIntegrationsModule` for tests/dev | real adapters (PayHere, Text.lk, Bunny, Zoom, R2, Resend) |

Test doubles: `InMemoryTenantResolver` and `InMemorySessionAuthenticator` in `src/common/testing/`, the provider mocks in `src/integrations/*/*.mock.ts`, which record calls and support `failNext()`. `test/fixtures/test-app.ts` boots the real app with them, using `overrideProvider`.

**Bind an endpoint from the registry:**

```ts
@Controller() // no prefix: the path comes from the registry (checked at boot)
export class AuthController {
  @Public()
  @RateLimit(
    { name: 'login-phone', limit: 5, windowSec: 60, by: (req) => phoneFromBody(req.body) },
    { name: 'login-ip', limit: 20, windowSec: 60, by: 'ip' },
  )
  @Endpoint(API.studentLogin) // POST /api/v1/auth/student/login, 200, strict body, response schema
  login(
    @Body() body: EndpointBody<typeof API.studentLogin>,
    @CurrentTenant() tenant: ResolvedTenant,
  ): Promise<EndpointResult<typeof API.studentLogin>> { … }
}
```

`@Endpoint` parses the body with the request schema: unknown fields return 400 and the handler never runs. A bodyless endpoint accepts only no body or `{}`. The result goes through the response schema, so undeclared fields are stripped and a contract mismatch returns 500 and is logged. The handler's return type is checked against the contract at compile time. Rate-limit `by` functions run before validation, so they must read `req.body` defensively. Keys are always `t:<tenantId>:rl:<rule>:<sha256>`.

**Register a readiness check:** inject the global `ReadinessRegistry` and call `register({ name: 'database', check: () => … })` once at boot. `GET /health/ready` runs all checks (2 s timeout each) and answers 503 if any fails or while the app shuts down.

**Request context:** `currentContext()` / `requireContext()` (AsyncLocalStorage) give `requestId`, `host`, `protocol`, `origin`, `clientIp` (personal data, never log it), `area`, `tenant` and `session`. Param decorators: `@CurrentTenant()`, `@CurrentSession()`.

## Folder structure

```
apps/api/
├── src/
│   ├── main.ts / worker.ts        entries (HTTP API / Nest application context for BullMQ, ADR 0012)
│   ├── bootstrap.ts               configureApp(): helmet, body limit, trust proxy, prefix, shutdown hooks
│   ├── app.module.ts              CoreModule (config, logger, guards, filter, extension points) + HealthModule
│   ├── worker.module.ts           WorkerModule + createWorker()
│   ├── config/                    Zod env schema, loadConfig()
│   ├── common/
│   │   ├── auth/                  SessionAuthenticator, @Public, @Roles, @CurrentSession, AuthGuard, RolesGuard
│   │   ├── context/               AsyncLocalStorage request context + middleware
│   │   ├── errors/                AppException, toProblem, ProblemFilter
│   │   ├── http/                  trusted proxies, forwarded host/proto/IP
│   │   ├── logging/               pino params (redaction, context mixin)
│   │   ├── rate-limit/            RateLimiter, InMemoryRateLimiter, @RateLimit + guard
│   │   ├── security/              CSRF check + guard, @SkipCsrf
│   │   ├── tenant/                TenantResolver, TenantGuard, @HostScope
│   │   ├── testing/               in-memory doubles for tests
│   │   └── validation/            @Endpoint, EndpointInterceptor, boot-time EndpointVerifier
│   ├── health/                    /health, /health/ready, ReadinessRegistry
│   ├── integrations/              payment/ sms/ video/ meeting/ storage/ email/ — interface + mock each
│   └── modules/                   (Track E onwards) auth, tenants, classes, fees, …
└── test/                          e2e tests against the real app + fixtures
```

Planned modules (unchanged): `auth`, `tenants`, `students`/`classes`/`enrollments`, `fees`, `lessons`, `live`, `attendance`, `messages`, `website`, `platform`. Platform impersonation is **30 minutes**, reason required and audited (ADR 0004). The database schema, migrations and `withTenant()` live in `packages/db`. Every tenant table has `tenant_id` + RLS, and the app DB role is not the table owner.
