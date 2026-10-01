# 0003 — Same-origin `/api/v1` on every host via the edge proxy

- **Status:** Accepted · 2026-10-02
- **Settles:** [03-architecture §2 "Same-origin API"](../plan/03-architecture.md#same-origin-api-adr-needed) and the CSRF row of [§4](../plan/03-architecture.md#4-identity--access) (replaces the double-submit token); [DEVELOPMENT.md §5.3](../../DEVELOPMENT.md#53-web-application-owasp-top-10) CSRF and CORS rows; [roadmap §6](../plan/05-roadmap.md#6-decision-backlog-adrs) item 0003.

## Context

The platform is served on many hosts: `<slug>.remix.lk` per institute, verified custom domains (TEN-04, R2) and `admin.remix.lk`. Every one of them needs the API with the user's session. Students are mostly on phones, many on iOS Safari, where cross-site cookies are blocked by Intelligent Tracking Prevention.

All `*.remix.lk` hosts are **same-site** with each other (the site is `remix.lk`). `SameSite=Lax` therefore does not stop a page on `a.remix.lk` from sending a request with `b.remix.lk`'s cookies to `b.remix.lk`. Tenant pages can't run their own scripts (page-builder blocks are data, never HTML/JS), but an XSS bug or a dangling DNS record on any subdomain would turn it into a CSRF launch pad against every other tenant.

## Decision

### Routing

- The browser always calls **`/api/v1/*` on the host it is on** (`https://kamalphysics.remix.lk/api/v1/me/classes`). There is no `api.remix.lk`.
- **Production:** the edge proxy (Kamal proxy) routes requests by path: `/api/v1/*` → `apps/api`, everything else → `apps/web`. The prefix is not stripped; the API mounts its routes at `/api/v1` itself. Infra must verify that the deployed Kamal proxy supports path-prefix routing for wildcard and custom hosts; if it can't, a thin Caddy/nginx layer in front keeps exactly this contract.
- **Development:** a Next.js rewrite in `apps/web` sends `/api/v1/:path*` to `http://localhost:4000/api/v1/:path*` ([phase-1 §3](../plan/phase-1.md#3-local-development-topology)). The web app's `proxy.ts` matcher excludes `/api/v1`, so dev and prod behave the same way.
- The API serves platform routes (`/api/v1/platform/*`) only on `admin.remix.lk` and tenant routes only on tenant hosts. A route on the wrong kind of host returns 404.
- Realtime (Socket.io) lives under the same prefix and checks `Origin` on the upgrade request (cross-site WebSocket hijacking).

### Host and client IP

- `TRUST_PROXY` lists the addresses allowed to set forwarding headers: the edge proxy and web nodes on the private network, plus Cloudflare's published ranges. Loopback only in dev. It is never `true`/`*`.
- The request host is `X-Forwarded-Host` **only when the TCP peer is in `TRUST_PROXY`**, otherwise `Host`. The edge proxy overwrites `X-Forwarded-Host` (or, if it forwards `Host` unchanged, strips any inbound `X-Forwarded-Host`). A forwarded host containing a comma is rejected. Infra ships a test that a forged `X-Forwarded-Host` sent through the public edge is ignored.
- The host is lower-cased and a trailing dot removed, then resolved to a tenant (TEN-01, [ADR 0005](0005-tenancy-shared-schema-rls.md)). Unknown or unverified host → 404 `TENANT_NOT_FOUND`.
- Client IP = the first address in `X-Forwarded-For` that is not in `TRUST_PROXY`, walking from the right. It feeds rate limits (AUTH-09) and audit logs.

### Cookies and CORS

- Auth cookies are **host-only** (no `Domain=`), `HttpOnly; Secure; SameSite=Lax; Path=/`, with the `__Host-` prefix in production ([ADR 0004](0004-own-authentication.md)). A cookie set on one tenant host is never sent to another, and custom domains work exactly like subdomains.
- **No CORS.** The API sends no `Access-Control-Allow-*` headers and does not call `enableCors`. Every legitimate browser call is same-origin.

### CSRF guard (every state-changing request)

A global API guard runs on every method other than `GET`, `HEAD` and `OPTIONS`, before authentication:

1. If `Sec-Fetch-Site` is present, it must be `same-origin` or `none`. `same-site` is rejected: that is exactly the sibling-tenant case.
2. If `Origin` is present, it must equal the request's own origin: scheme from the trusted `X-Forwarded-Proto`, host and port from the trusted host above. `Origin: null` is rejected.
3. A request with a body must be `Content-Type: application/json` (parameters such as `charset` allowed). JSON is not a CORS-safelisted type, so a cross-origin browser request needs a preflight, which fails because we send no CORS headers.
4. A request carrying **neither** `Origin` nor `Sec-Fetch-Site` is treated as non-browser: server-to-server from `apps/web` ([ADR 0006](0006-web-api-data-access.md)) or a script. A non-browser client cannot attach a victim's ambient cookies, so it can only act as whoever's cookie it already holds.

Failures return 403 `CSRF_REJECTED` (415 for a wrong content type) as `application/problem+json`. Login is guarded too, which prevents login CSRF. `GET`/`HEAD` never change state. Business actions take a strict JSON body (at minimum `{}`), so the only bodyless state-changing endpoint is `POST /auth/logout`. Webhooks (`/api/v1/webhooks/*`) skip this guard and the JSON rule (PayHere posts form-encoded). They never read the session cookie and are authenticated by provider signature ([03-architecture §6](../plan/03-architecture.md#6-api-design)).

### Why this replaces the double-submit token

- The OWASP CSRF Prevention Cheat Sheet documents Fetch Metadata and standard-header (`Origin`) verification as defences. Go 1.25's `net/http` `CrossOriginProtection` uses the same algorithm. Every browser we support sends `Origin` on cross-origin POSTs, and current ones (including Safari 16.4+) also send `Sec-Fetch-Site`.
- A plain double-submit cookie is weak here: a compromised sibling subdomain can toss a `Domain=.remix.lk` CSRF cookie and supply the matching value. Fixing that means a session-bound, signed token.
- A token must reach every form, server action and client island and pass through the web → API hop. With Server Components that is many moving parts for no extra protection over header checks plus JSON-only bodies plus SameSite.

## Alternatives considered

- **`api.remix.lk` + credentialed CORS.** Rejected. From a custom domain the API cookie is a third-party cookie, which Safari ITP and other browser restrictions block. The CORS allow-list would have to track every verified custom domain at runtime, and reflecting `Origin` is a classic misconfiguration. The tenant could no longer come from `Host`, and one cookie jar on `api.remix.lk` would hold every tenant's session.
- **Add `remix.lk` to the Public Suffix List** so tenant subdomains become cross-site. Not now: inclusion takes months, is effectively irreversible and reaches browsers slowly, and custom domains would still need the same guard. It stays open as a later hardening step.

## Consequences

- One cookie per host. A user who visits both `slug.remix.lk` and the institute's custom domain signs in on each. TEN-04 makes one host primary and redirects the other.
- Impersonation can't simply set a cookie for a tenant host from `admin.remix.lk`. It needs a one-time handoff to the tenant host, specified in ADR 0015.
- Cloudflare must never cache `/api/v1/*` (cache-bypass rule). Authenticated responses also send `Cache-Control: no-store`.
- `apps/api/README.md` ("CORS allowlist", "trust proxy (Cloudflare only)") is superseded by this ADR.

## Security notes

- Residual risk: a browser that sends neither header on a cross-site POST, which in practice means only pre-2020 browsers. JSON-only bodies still block every forged action that has a body. Forged logout is the accepted remainder.
- None of these checks help against XSS on the same origin. CSP with nonces and output encoding ([DEVELOPMENT.md §5.3](../../DEVELOPMENT.md#53-web-application-owasp-top-10)) cover that.
- Tests: guard unit tests for each header combination (`same-site` → 403; `Origin` of a sibling tenant → 403; neither header → allowed; `text/plain` body → 415), plus an E2E check that a page on tenant A cannot change data on tenant B.
