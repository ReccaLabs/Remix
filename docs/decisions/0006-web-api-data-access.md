# 0006 — Web ↔ API data access: the web app only talks to the API

- **Status:** Accepted · 2026-10-02
- **Settles:** [03-architecture §2 containers](../plan/03-architecture.md#containers), [§6 Client](../plan/03-architecture.md#6-api-design) and [§9](../plan/03-architecture.md#9-frontend-architecture-appsweb) (data fetched server-side via the typed client); [roadmap §6](../plan/05-roadmap.md#6-decision-backlog-adrs) item 0006.

## Context

`apps/web` (Next.js 16, Server Components) renders the tenant site, portal, institute admin and platform admin. It could read Postgres directly, which is fast to write and saves a hop. But then authorisation would live in two places, and the internet-facing renderer would hold database credentials. Phase 1 has parallel tracks building web and API at the same time, so the boundary has to be a contract both sides compile against.

## Decision

### The rule

**`apps/web` never connects to the database.** It has no `DATABASE_URL`, no dependency on `@remix/db` and no SQL. ESLint `no-restricted-imports` plus a package-graph check in CI enforce this. All data goes through the REST API `/api/v1` ([ADR 0003](0003-same-origin-api-via-edge-proxy.md)).

### Server side (Server Components, server actions, `proxy.ts`)

- `src/server/api-client.ts` (`server-only`) builds a `createApiClient` from `@remix/types/api` per request:
  - `baseUrl` = `API_INTERNAL_URL`, the API on the private network (`http://localhost:4000` in dev).
  - `headers()` forwards exactly:
    - `cookie`: only the ReMix session and device cookies ([ADR 0004](0004-own-authentication.md)), nothing else the browser sent;
    - `x-forwarded-host`: the tenant host;
    - `x-forwarded-proto`;
    - `x-forwarded-for`: the client IP, computed with the same `TRUST_PROXY` rule as the API. Without it every login would appear to come from the web node and per-IP rate limits would throttle a whole institute;
    - `x-request-id`: generated in `proxy.ts` if absent.
- It does **not** forward `Origin` or `Sec-Fetch-*`. These calls are server-to-server and pass the CSRF guard as non-browser requests. Browser-facing CSRF protection for server actions is Next.js's built-in `Origin` vs host check. `serverActions.allowedOrigins` stays unset.
- Web nodes are in the API's `TRUST_PROXY`, so their forwarded host and IP are believed. Nothing else on the network is.
- Calls use `cache: 'no-store'` (the client's default). Per-user data is never put in the Next.js data cache. Independent calls on one page run in parallel. When a screen needs many calls, the API gets a screen-shaped endpoint (`GET /me/home`). The web app never gets a shortcut to the DB.
- **Cookies are only changed where they can reach the browser.** Login and logout are called from the browser directly (client island → same-origin `/api/v1`), so `Set-Cookie` comes straight from the API. Session refresh runs in `proxy.ts`, which relays `Set-Cookie` ([ADR 0004](0004-own-authentication.md)). Server Components never trigger a cookie change.

### Client islands

Client islands (forms, tables, upload queues, players) use `createApiClient()` with an empty `baseUrl`. That is a same-origin `/api/v1` call with `credentials: 'same-origin'`, where the browser attaches the cookie and the CSRF headers itself. TanStack Query wraps these calls.

### One authorisation layer

The API guards plus RLS ([ADR 0005](0005-tenancy-shared-schema-rls.md)) are the only authorisation. The web app may hide UI using `GET /auth/session` roles, but it doesn't make access decisions. A hidden button is not a permission. Route groups redirect to login on 401 `UNAUTHENTICATED` and show the unavailable page on `TENANT_UNAVAILABLE`, by branching on `problem.code`.

### Contracts

- Every endpoint is registered once in `packages/types/src/api/routes.ts` with strict Zod request/response schemas.
- The API validates with those schemas (`ZodValidationPipe`). The client validates requests before sending and responses on arrival, so contract drift fails loudly in tests and logs rather than as `undefined` in a component.
- Changing a schema breaks typecheck on both sides until they agree. Contract changes go through the lead ([phase-1 §1](../plan/phase-1.md#1-working-agreement)).
- OpenAPI for docs and future mobile/gate apps is generated from the same registry. The TypeScript client is typed from it directly, not generated.

## Alternatives considered

- **Server Components query Postgres via Drizzle (API only for mutations or for mobile).** Rejected:
  - every read path would need its own guards, so two authorisation layers drift apart;
  - the web tier would hold DB credentials and set RLS context itself;
  - an RSC or server-action bug would sit one step from the database.

  The hop it saves is about 1 ms on the private network.

- **tRPC / GraphQL.** A REST + Zod registry already gives end-to-end types. REST keeps one simple surface for the browser, the server, webhooks and future native apps, and keeps HTTP caching and status codes straightforward.

## Consequences

- An extra network hop and JSON (de)serialisation per server-side call. Fine against the < 300 ms p95 budget; k6 watches it.
- `apps/web` can be deployed, scaled and broken without touching the database. A compromised web node has no more power than the sessions it sees.
- The API must offer everything a screen needs, including aggregate "screen" endpoints. Web tracks that need a new endpoint ask the lead for a contract change rather than working around it.

## Security notes

- Never log forwarded cookies. `x-request-id` ties web and API logs together and appears as `requestId` in problem responses.
- The forwarded header set is an allow-list in one file. Adding a header is a reviewed change.
- The `x-forwarded-for` forwarding is not yet in the `ApiClientOptions` doc comment (which mentions `cookie` and `x-forwarded-host`). Track W implements it as described here.
