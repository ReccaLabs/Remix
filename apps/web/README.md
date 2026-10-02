# apps/web — tenant sites, student portal, institute admin, platform admin

Next.js 16 (App Router, React 19, RSC by default), Tailwind v4 + `@remix/ui`, next-intl. One app serves every institute host (`<slug>.remix.lk` or a verified custom domain) and the platform admin (`admin.remix.lk`). Screen → route map: [DESIGN.md §4.2–4.4](../../DESIGN.md#4-screen--route-map). Decisions: [ADR 0003](../../docs/decisions/0003-same-origin-api-via-edge-proxy.md) (same-origin API), [ADR 0004](../../docs/decisions/0004-own-authentication.md) (sessions), [ADR 0006](../../docs/decisions/0006-web-api-data-access.md) (web only talks to the API).

## Run it

```bash
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @remix/web mock-api   # stand-in API on :4000 until apps/api serves /tenant
pnpm --filter @remix/web dev        # http://kamalphysics.localhost:3001 · http://admin.localhost:3001
pnpm --filter @remix/web test       # unit tests (vitest)
```

`*.localhost` resolves to 127.0.0.1 in Chrome, Edge and Firefox without any hosts-file change. The mock API (`test/mock-api.mjs`, dev only) knows the seed slugs `kamalphysics` (active, brand colour), `royalscience` (trial) and `closedacademy` (suspended) and answers `GET /api/v1/_debug/headers` with the headers it received.

## How a request reaches the right area

`src/proxy.ts` (Next 16 proxy, formerly middleware) runs on every request except `/api/v1/*`, `/_next/*` and `/icon.svg`:

1. `classifyHost(host, config)` (`src/lib/host.ts`, pure, unit-tested) normalises the `Host` header (lower-case, strip port and trailing dot, reject IP literals and malformed names) and returns:

   | Host                                                                | Result                                                     |
   | ------------------------------------------------------------------- | ---------------------------------------------------------- |
   | one of `PLATFORM_HOSTS`                                             | `{ area: 'platform' }`                                     |
   | `<slug>.<base>` for a `TENANT_BASE_DOMAINS` entry, slug not reserved | `{ area: 'tenant', host }`                                 |
   | the bare base domain, nested or reserved sub-domains                | `{ area: 'unknown' }`                                      |
   | any other multi-label name (possible custom domain)                 | `{ area: 'tenant', host }` — the API decides (404 if not verified) |
   | IP literal, single label, empty, garbage                            | `{ area: 'unknown' }`                                      |

2. `decideRoute()` (`src/lib/routing.ts`) rewrites into a real internal segment — route groups can't share URL paths, so each area is a folder: `/x` → `/tenant/x` or `/platform/x`. Unknown hosts and **direct requests to `/tenant…` or `/platform…`** are rewritten to `/__remix_not_found`, which no route matches (App Router ignores `_` folders), so they get the global 404. Tenant page-builder slugs must therefore never be `tenant` or `platform`.
3. Server code gets the result through request headers the proxy always overwrites or deletes (`src/lib/request-headers.ts`): `x-remix-area`, `x-remix-host` (normalised host), `x-request-id` (an upstream id is kept if log-safe, else a UUID; also returned on the response), `x-nonce`, plus the request's `content-security-policy` from which Next.js reads the nonce. A client can't choose the tenant: it only ever comes from the classified host.
4. Wave 2 inserts session refresh (`POST /api/v1/auth/session/refresh`, ADR 0004) in the marked spot before the rewrite.

## Same-origin API (ADR 0003)

The browser always calls `/api/v1/*` on its own host. **Production:** the edge proxy (Kamal) routes that path to `apps/api` before Next.js. **Dev:** `next.config.ts` rewrites `/api/v1/:path*` → `${API_INTERNAL_URL}/api/v1/:path*` (also in a production build made with `WEB_API_REWRITE=true`, for local prod-like runs and E2E; rewrites are fixed at build time).

What Next.js's external rewrite sends to the API (verified with `/api/v1/_debug/headers`, Next 16.3):

| Header | Value |
| --- | --- |
| `Host` | the API's host (`localhost:4000`) — `changeOrigin` |
| `X-Forwarded-Host` | the browser's `Host` header **including the port** (`kamalphysics.localhost:3001`); a client-sent `X-Forwarded-Host` is overwritten |
| `X-Forwarded-For` / `-Proto` / `-Port` | **not added**; whatever the client sent passes through unchanged |
| everything else (`Cookie`, `Origin`, `Sec-Fetch-*`, body) | passed through unchanged |

So in dev the API must strip the port from the forwarded host and trust it only from loopback (`TRUST_PROXY`). The proxy's security headers are not added to `/api/v1` responses (excluded from the matcher); the API sets its own.

## Server access to the API (ADR 0006)

`apps/web` never touches the database. Server code (`import 'server-only'`) calls the API with `createApiClient` from `@remix/types/api`:

| Helper (`src/server/…`) | Signature | Behaviour |
| --- | --- | --- |
| `api.ts` `getTenant` | `() => Promise<TenantPublic>` | `GET /tenant` for the proxy-classified host, cached per request. Unknown host or non-tenant area → `notFound()` |
| `api.ts` `findTenant` | `() => Promise<TenantPublic \| null>` | same call, `null` instead of 404 (root layout) |
| `api.ts` `getSession` | `() => Promise<SessionResponse \| null>` | `GET /auth/session`; 401 → `null`; other errors throw |
| `api.ts` `requireStudent` | `() => Promise<SessionResponse>` | student of *this* institute, else `redirect('/login')` |
| `api.ts` `requireStaff` | `(roles?: readonly StaffRole[]) => Promise<SessionResponse>` | staff of this institute, else `redirect('/admin/login')`; none of `roles` → `notFound()` |
| `api.ts` `getApi` | `() => Promise<ApiClient>` | the per-request client for any other endpoint (`(await getApi()).call('myClasses')`) |
| `api.ts` `problemCode` | `(err: unknown) => ErrorCode \| null` | branch on `UNAUTHENTICATED`, `TENANT_UNAVAILABLE`… |
| `request.ts` `getRequestContext` | `() => Promise<RequestContext>` | area, host, request id, nonce, cookie, forwarded-for/proto |
| `env.ts` `getEnv` | `() => Env` | Zod-validated env, checked at boot by `src/instrumentation.ts` |

Forwarded headers are an allow-list built from scratch (`forwardedHeaders`): `cookie` (only `remix_session`/`remix_device` and their `__Host-` forms), `x-forwarded-host` (normalised host, no port), `x-forwarded-proto`, `x-forwarded-for` (the chain as received from the edge; the API applies `TRUST_PROXY` to it — App Router code can't see the TCP peer), `x-request-id`. Never `origin` or `sec-fetch-site`. Node's `fetch` itself adds `sec-fetch-mode: cors`, `user-agent: node` and `accept-language: *`; ADR 0003's guard keys on `Sec-Fetch-Site`/`Origin`, so these calls count as non-browser. Each call times out after 10 s.

The UI only hides things; the API enforces every permission. Client islands call `createApiClient()` with an empty `baseUrl` (same-origin). Login and logout are called from the browser so `Set-Cookie` reaches it; Server Components never change cookies.

## Pages, errors, theming

- `app/layout.tsx` is the one `<html>`: fonts, `lang`, skip link, and the institute's brand colours as CSS variables on `<html>` (`--color-brand`, `-hover`, `-soft`, TEN-03). The colour is re-validated with `brandColorSchema` in `src/lib/brand.ts` and only applied while the institute is live.
- `app/tenant/layout.tsx` resolves the tenant (404 for unknown hosts) and sets `<title>` from its name. `app/tenant/(site)/layout.tsx` applies `tenantAccess(status)` (TEN-06): suspended/cancelled → `TenantUnavailable` (name only, neutral theme, `noindex`). Track F applies the same check for the portal (`studentPortal`) and admin (`staff`).
- `not-found.tsx` per area plus a global one; `[...rest]/page.tsx` catch-alls give branded 404s inside each area. `error.tsx` per area and `global-error.tsx` show only the error digest. `loading.tsx` lives inside route groups so a page's `notFound()` still returns HTTP 404 (a `loading.tsx` above it would stream a 200).
- Next 16.3 renders a 404 raised by `notFound()` as an empty `__next_error__` shell (status 404) and the client draws the not-found UI from the RSC payload; JavaScript-less clients see a blank page. Unmatched paths that the proxy sends to `/__remix_not_found` are fully server-rendered.
- All text is in `messages/en/<namespace>.json` (`common`, `errors`, `tenant`, `platform`) with keys typed from the English files (`src/i18n/messages.ts`). No locale in URLs; English until si/ta pass native review.

## Security headers (`src/lib/security-headers.ts`, set by the proxy on every page and 404)

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic';
  style-src 'self' 'nonce-…'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:;
  font-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none';
  frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests
Strict-Transport-Security: max-age=31536000            (production only)
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: accelerometer=(), browsing-topics=(), camera=(), geolocation=(), …
Cross-Origin-Opener-Policy: same-origin
X-Frame-Options: DENY
```

- A fresh 128-bit nonce per request; Next.js stamps it on its scripts, preloads and stylesheets. Every page is dynamically rendered (the root layout reads the request), which nonces require.
- `style-src-attr 'unsafe-inline'`: React `style` props (the `@remix/ui` Logo geometry, the brand variables on `<html>`) are attributes, which nonces can't cover. They can't run script or use selectors; `url()` loads stay bounded by `img-src`/`font-src`. `<style>` elements still need the nonce.
- `next dev` adds `'unsafe-eval'` (React dev tooling) and `style-src 'unsafe-inline'` (dev CSS is injected without a nonce), and drops `upgrade-insecure-requests`.
- HSTS has no `includeSubDomains`/`preload`: on a custom apex domain it must not force HTTPS onto the institute's other sub-domains. `remix.lk` preload is set at the edge.
- New third-party scripts, frames, images or fonts mean updating this policy deliberately (and its tests).

## Environment

| Variable | Dev | Prod | Notes |
| --- | --- | --- | --- |
| `API_INTERNAL_URL` | `http://localhost:4000` | private API address | http(s) URL; trailing slash stripped |
| `TENANT_BASE_DOMAINS` | `localhost` | `remix.lk` | comma-separated; most specific wins |
| `PLATFORM_HOSTS` | `admin.localhost` | `admin.remix.lk` | comma-separated exact hosts |
| `WEB_API_REWRITE` | — | unset | build time; `true` keeps the `/api/v1` rewrite in a production build |

## Folder structure

```
apps/web/
├── messages/en/                  common · errors · tenant · platform
├── public/icon.svg
├── test/mock-api.mjs             dev-only stand-in API
└── src/
    ├── proxy.ts                  host → area rewrite, security headers + CSP nonce
    ├── instrumentation.ts        env validation at boot
    ├── app/
    │   ├── layout.tsx            <html>: fonts, brand variables, intl provider
    │   ├── not-found.tsx         global 404 · global-error.tsx
    │   ├── tenant/               every institute host
    │   │   ├── layout.tsx        getTenant() (404 for unknown hosts), <title>
    │   │   ├── (site)/           public website (TEN-06 gate) — placeholder page
    │   │   ├── [...rest]/        branded 404 · not-found.tsx · error.tsx
    │   │   └── (portal)/, admin/ Track F: student portal, institute admin
    │   └── platform/             admin.remix.lk
    │       ├── layout.tsx        noindex, area check
    │       ├── (shell)/          overview placeholder + loading
    │       └── [...rest]/        not-found.tsx · error.tsx
    ├── components/               status-page, error-view, page-skeleton, tenant/tenant-unavailable
    ├── i18n/                     config (locales), request (message loading), messages (typed keys)
    ├── lib/                      host, routing, security-headers, brand, cookies, paths, fonts
    └── server/                   server-only: env, request context, api (getTenant, getSession…)
```

## Rules specific to this app

- Every server action / route handler re-checks the session and role — UI hiding is not authorization.
- Never read the tenant from a query string, cookie, body or any header other than what the proxy set.
- Cookies are host-only (no `Domain=.remix.lk`), `HttpOnly; Secure; SameSite=Lax`, set only by the API.
- Brand colours only through `brandStyle()`; never interpolate tenant data into CSS or `<style>`.
- Student routes: < 200 KB JS, no chart libraries.
