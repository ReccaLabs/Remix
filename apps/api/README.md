# apps/api — NestJS API and worker

NestJS 11 (Express) modular monolith. The browser always calls it **same-origin** at `/api/v1/*` on the host it is on. The edge proxy routes that path here, so there is **no CORS and no CORS allow-list** ([ADR 0003](../../docs/decisions/0003-same-origin-api-via-edge-proxy.md)). `apps/web` calls it server-side with the typed client ([ADR 0006](../../docs/decisions/0006-web-api-data-access.md)). Contracts come from `@remix/types/api`. Rules: [DEVELOPMENT.md §4.1 and §5](../../DEVELOPMENT.md).

**Status:** core infrastructure (Track C) plus tenancy and authentication (Track E): host → tenant from Postgres (TEN-01/02/06), student and basic staff login (AUTH-01, AUTH-05), opaque rotating sessions with reuse detection, devices, logout and `GET /me/classes` ([ADR 0004](../../docs/decisions/0004-own-authentication.md)).

## Commands

```bash
pnpm --filter @remix/api dev         # tsdown --watch, restarts node on :4000
pnpm --filter @remix/api build       # → dist/main.js (API) + dist/worker.js (worker)
pnpm --filter @remix/api start       # node dist/main.js
pnpm --filter @remix/api start:worker
pnpm --filter @remix/api test        # Vitest: unit + e2e (in-memory doubles) + integration (Postgres in Docker)
pnpm --filter @remix/api exec vitest run --project unit          # no Docker needed
pnpm --filter @remix/api exec vitest run --project integration   # fresh database on the dev stack's Postgres (Testcontainers if it is down)
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
| `TRUST_PROXY` | `loopback` | IPs/CIDRs/`loopback`/`linklocal`/`uniquelocal`/`none`. Only these peers' `X-Forwarded-Host/-Proto/-For` are believed. In production it must list the edge proxy / web node addresses: empty, `none` or loopback-only is rejected at boot (every client would share the proxy's IP) |
| `TENANT_BASE_DOMAINS` | `localhost` | `remix.lk` in prod (localhost rejected in production) |
| `PLATFORM_HOSTS` | `admin.localhost` | `admin.remix.lk` in prod |
| `COOKIE_SECURE` | `true` in production | must be `true` in production (served over https). `true` → `__Host-remix_session` / `__Host-remix_device` + `Secure`; `false` → `remix_session` / `remix_device` (plain-HTTP dev) |
| `DATABASE_URL` | — | **required**: Postgres as `remix_app`. Boot fails if the role is superuser, `BYPASSRLS` or owns tables |

## Run against the dev stack

```bash
docker compose -f infra/docker/compose.yaml up -d          # Postgres 18, Valkey, Mailpit, S3
cp packages/db/.env.example packages/db/.env
pnpm --filter @remix/db migrate                              # as remix_owner
pnpm --filter @remix/db seed                                 # kamalphysics, royalscience, closedacademy
cp apps/api/.env.example apps/api/.env                       # DATABASE_URL = remix_app
pnpm --filter @remix/api dev                                 # :4000, reads apps/api/.env
```

If 5432 is taken, set `POSTGRES_PORT` in `infra/docker/.env` and use that port in both `.env` files (or run the stack under another project name: `docker compose -p remix-e -f … up -d`). The browser reaches the API through the web app's `/api/v1` rewrite; from a shell, act as the web server would — call from loopback with `x-forwarded-host`:

```bash
curl -si -c jar -H 'x-forwarded-host: kamalphysics.localhost' -H 'content-type: application/json'   -d '{"phone":"0710001042","password":"remix-dev-password"}' http://localhost:4000/api/v1/auth/student/login
curl -s -b jar -H 'x-forwarded-host: kamalphysics.localhost' http://localhost:4000/api/v1/me/classes
```

Seed logins and the dev password are in [`packages/db/README.md`](../../packages/db/README.md#seed-logins-dev-only--never-real-credentials).

## Tenancy and sessions (Track E)

| Endpoint | Success | Errors |
| --- | --- | --- |
| `GET /api/v1/tenant` (public) | 200 public tenant record, any status | 404 `TENANT_NOT_FOUND` |
| `POST /api/v1/auth/student/login` | 200 session + cookies | 400 `VALIDATION_FAILED`, 401 `INVALID_CREDENTIALS`, 403 `ACCOUNT_DISABLED` (correct password only; disabled or archived), 403 `TENANT_UNAVAILABLE` (suspended/cancelled), 403/415 `CSRF_REJECTED`, 404 `TENANT_NOT_FOUND`, 429 `RATE_LIMITED` + `Retry-After` |
| `POST /api/v1/auth/staff/login` | same (identifier = phone or email) | as above; `TENANT_UNAVAILABLE` only when cancelled (suspended = billing-only) |
| `GET /api/v1/auth/session` | 200 session | 401 `UNAUTHENTICATED` (also when the tenant's status no longer allows this user) |
| `POST /api/v1/auth/session/refresh` | 200; `Set-Cookie` only when it rotated | 401 `UNAUTHENTICATED` |
| `POST /api/v1/auth/logout` | 204, clears both session cookie names | — |
| `GET /api/v1/me/classes` | 200 `{ items }` | 401, 403 `FORBIDDEN` (staff), 403 `TENANT_UNAVAILABLE` |

- **Tokens:** `<unixSeconds>.<43 base64url chars>` (256 random bits); only SHA-256 (hex) is stored. Device ids are 256-bit too, stored hashed.
- **Cookies:** host-only (no `Domain`), `Path=/; HttpOnly; SameSite=Lax`, `Secure` with `COOKIE_SECURE`. The session cookie has `Max-Age` = time left of a 30-day "stay signed in" session, otherwise none (browser-session cookie; the server still ends it at 12 h). The device cookie lives 400 days. Only the configured name is read.
- **Lookup:** host → tenant first, then `token_hash` (or `prev_token_hash`) inside that tenant's `withTenant`, so another tenant's cookie matches nothing. Rejects revoked, expired, disabled, archived or signed-out-device sessions. `sessions.last_seen_at` is written at most once a minute, `devices.last_seen_at` every 5 minutes.
- **Rotation:** only refresh rotates, when the token is ≥ 15 min old. The previous token stays valid for 120 s (no second rotation); after that its use revokes the whole family, writes `session.reuse_detected` and answers 401. Lifetimes (12 h / 30 days) are absolute.
- **Login:** tenant status first, lookup by kind inside `withTenant`, Argon2id verify outside the transaction, a boot-time dummy hash for unknown users, `ACCOUNT_DISABLED` only after a correct password, a fresh token every time (a session the browser already had is revoked as `replaced`), re-hash when parameters change.
- **TEN-06:** `@TenantAccess('full' | 'session' | 'always')` on routes, enforced by `TenantAccessGuard` after the auth guard.
- **Rate limits (AUTH-09 basic):** login 5/min per normalised phone/email and 20/min per client IP, shared by both login endpoints.
- **Audit (`audit_logs`, same transaction):** `auth.login.succeeded`, `auth.login.failed` (reason; masked identifier `+94*******42`; actor null for unknown users), `auth.logout`, `session.reuse_detected`. Each row has the request id and client IP. No password, token, hash or full phone/email.
- **Clock:** every time decision uses the injected `CLOCK` (`systemClock` in production, `ManualClock` in tests); instants are written explicitly, not from the database's `now()`.

## Request pipeline

```
request-context middleware   requestId (x-request-id), host/proto/origin/client IP from trusted forwarding only, AsyncLocalStorage
helmet                       CSP default-src 'none'; frame-ancestors 'none', nosniff, DENY, no-referrer (HSTS in prod)
JSON body parser             application/json only, 100 kb, strict; errors → problem+json (400/413/415)
pino-http (nestjs-pino)      one JSON line per request: requestId, tenantId, userId, method, path, status
guards (global, in order)    CsrfGuard → TenantGuard → AuthGuard → TenantAccessGuard → RateLimitGuard → RolesGuard
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

| Token | Interface | Bound to | Next |
| --- | --- | --- | --- |
| `TENANT_RESOLVER` | `TenantResolver.resolve(host) → ResolvedTenant \| null` | `DbTenantResolver` (`resolveTenantByHost` + 60 s in-process `TenantCache`); `NullTenantResolver` with `database: false` | Valkey `TenantCache` later |
| `SESSION_AUTHENTICATOR` | `SessionAuthenticator.authenticate({ req, res, tenant }) → AuthSession \| null` | `DbSessionAuthenticator` (ADR 0004); `NullSessionAuthenticator` with `database: false` | — |
| `CLOCK` | `Clock.now() → Date` | `systemClock` | `ManualClock` in tests |
| `RATE_LIMITER` | `RateLimiter.consume(key, limit, windowSec)` | `InMemoryRateLimiter` | Valkey `INCR`/`EXPIRE` |
| `PAYMENT_PROVIDER`, `SMS_PROVIDER`, `VIDEO_PROVIDER`, `MEETING_PROVIDER`, `STORAGE_PROVIDER`, `EMAIL_PROVIDER` | `src/integrations/<kind>/<kind>.provider.ts` | unbound in `AppModule`; `MockIntegrationsModule` for tests/dev | real adapters (PayHere, Text.lk, Bunny, Zoom, R2, Resend) |

`AppModule.forRoot({ config, database: false })` boots the core pipeline without the database modules (core e2e tests only). Test doubles: `InMemoryTenantResolver` and `InMemorySessionAuthenticator` in `src/common/testing/`, the provider mocks in `src/integrations/*/*.mock.ts`, which record calls and support `failNext()`. `test/fixtures/test-app.ts` boots the real app with them, using `overrideProvider`.

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
│   └── modules/                   db (pool, boot check, readiness), tenancy, auth, audit, classes; later fees, …
└── test/                          e2e tests against the real app + fixtures
```

Planned modules (unchanged): `auth`, `tenants`, `students`/`classes`/`enrollments`, `fees`, `lessons`, `live`, `attendance`, `messages`, `website`, `platform`. Platform impersonation is **30 minutes**, reason required and audited (ADR 0004). The database schema, migrations and `withTenant()` live in `packages/db`. Every tenant table has `tenant_id` + RLS, and the app DB role is not the table owner.
