# 0004 — Own authentication instead of Better Auth

- **Status:** Accepted · 2026-10-02
- **Settles:** the Library, Passwords, Sessions and Devices rows of [03-architecture §4](../plan/03-architecture.md#4-identity--access); [roadmap §6](../plan/05-roadmap.md#6-decision-backlog-adrs) item 0004; closes risk **R2** in [roadmap §5](../plan/05-roadmap.md#5-risk-register). Reverses recommendation #2 in DEVELOPMENT.md §0.

## Context

Requirements ([02-features AUTH](../plan/02-features.md#auth--identity-sessions-devices)):

- **Tenant-scoped identities.** `tenant_users` is unique on `(tenant_id, phone)`. The same phone at two institutes is two separate accounts.
- Students log in with phone + password (AUTH-01). Staff use phone or email + password (AUTH-05). SMS OTP for password reset and staff 2-step comes later (AUTH-02/05).
- **2-device limit** for students, with a device list, self sign-out (AUTH-03/04) and admin sign-out of one or all devices (AUTH-08).
- Session and device tables carry `tenant_id` and are under RLS like every other tenant table ([ADR 0005](0005-tenancy-shared-schema-rls.md)).
- Impersonation sessions: 30 min, flagged and audited (PLT-04).
- Must work with host-only cookies and the same-origin API ([ADR 0003](0003-same-origin-api-via-edge-proxy.md)), and with Server Components that call the API server-side ([ADR 0006](0006-web-api-data-access.md)).

## Decision

We build authentication ourselves, following the session model in 03-architecture §4, from vetted primitives only. All of it lives in `apps/api` `modules/auth`.

### Passwords

- **Argon2id** via `@node-rs/argon2` with m = 19456 KiB, t = 2, p = 1 (OWASP). Prebuilt N-API binaries, no install scripts, so it fits `allowBuilds` deny-by-default. The stored PHC string carries its parameters, so login re-hashes when they change.
- 8–128 characters (`PASSWORD_LIMITS` in `@remix/types`). The upper bound caps hashing cost. A common/breached-password check comes in Phase 2 (AUTH-09).

### Sessions

- On login the API creates a `sessions` row (`tenant_id`, `user_id`, `device_id`, `token_hash`, `prev_token_hash`, `rotated_at`, `expires_at`, `stay_signed_in`, `revoked_at`, `revoked_reason`, `impersonated_by`) and returns an **opaque token**: 256 bits from `crypto.randomBytes`, base64url, prefixed with its issue time (`<unixSeconds>.<random>`). **Only `SHA-256(token)` is stored.** A fast hash is enough for a 256-bit random value, and a DB dump yields no usable tokens.
- Cookie: `__Host-remix_session` in production (`remix_session` in plain-HTTP dev), `HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain`. The API refuses to start in production with insecure cookie settings. The token never appears in a response body, log, URL or error report.
- **Absolute lifetime:** 12 h, or 30 days with "stay signed in" (AUTH-01). Never extended by activity or rotation. Without "stay signed in" the cookie is a browser-session cookie. Server-side `expires_at` is authoritative either way.
- **Lookup:** the API resolves the tenant from the host first, then finds the session by `token_hash` **inside that tenant's `withTenant` context**. A tenant-A cookie presented on tenant B's host matches no row (RLS), so it is 401 `UNAUTHENTICATED`. The session's `tenant_id` is also asserted equal to the host tenant. It is one indexed lookup per request with no cache, so revocation is immediate. `devices.last_seen_at` is written at most every 5 minutes.

### Rotation (at most every 15 minutes) and reuse detection

- Only `POST /api/v1/auth/session/refresh` rotates; other calls never do. It is a no-op when the token is under 15 minutes old. Otherwise it moves `token_hash` to `prev_token_hash`, stores the new hash and sets the new cookie.
- **Why explicit:** Server Components call the API server-side and cannot set cookies, so a rotation triggered there would be lost. The browser would keep the old token and later trip reuse detection. Instead `apps/web` `proxy.ts`, which can set cookies, reads the issue-time prefix of the cookie on each navigation. When it is due, `proxy.ts` calls refresh, sets the returned cookie on the response, and passes the new cookie to the render. The prefix is only a hint: tampering changes the hash and invalidates the token.
- **Grace:** for 120 s after a rotation, the previous token is still accepted, without rotating again. This covers concurrent navigations and Next.js prefetches.
- **Reuse:** the previous token presented after the grace window means two parties hold the session. The whole session (the family) is revoked, `session.reuse_detected` is audit-logged, and the caller gets 401.

### Devices (students)

- A second cookie, `__Host-remix_device` (`remix_device` in dev), with the same attributes, holds a random 256-bit device id (stored hashed, Max-Age 400 days). A login presenting a known, not-signed-out device id reuses that device. Otherwise it creates one, labelled from the User-Agent.
- A student with 2 devices that have live sessions gets 409 `DEVICE_LIMIT` with the device list on a third login. To sign one out and continue (AUTH-03), the client re-submits the credentials with the chosen device id. That contract field lands with AUTH-03. There is no half-signed-in state.
- Signing out a device (by the student, staff or the limit) sets `signed_out_at/by` and revokes its sessions in the same transaction. Staff have devices and see their sessions, but are not limited.

### Login and revocation

- **No user enumeration:** an unknown phone/email still runs an Argon2id verify against a dummy hash computed at boot, and every failure is 401 `INVALID_CREDENTIALS`. `ACCOUNT_DISABLED` is returned only after a correct password. Rate limits and lockout follow AUTH-09, with Valkey keys `t:<tenantId>:…` plus per client IP.
- Login always issues a fresh token (no session fixation). Logout revokes the session and clears the cookie (204 always).
- **Password change or reset revokes all of the user's sessions.** The device that changed it gets a fresh session.
- **Impersonation sessions** are `sessions` rows with `impersonated_by` set. They last 30 minutes absolute, never "stay signed in", never count toward the device limit, and every request is audited with the flag. The cross-host handoff and owner notification belong to ADR 0015.
- Platform staff are a separate identity (`platform_staff`, `platform_sessions`, Google SSO + TOTP/WebAuthn, AUTH-06) using the same token and cookie mechanics on `admin.remix.lk`. Their specifics are decided when AUTH-06 is built.

## Alternatives considered

- **Better Auth.** A good, well-maintained library with phone-number and multi-session plugins, a Drizzle adapter and sensible defaults. It would spare us code where mistakes are costly. It fits our model poorly in three places:
  - Its user model is global (one user per phone/email, with organisations as memberships), the opposite of "same phone, separate account per institute". Per-tenant identities would mean an instance per tenant or bending its schema.
  - Its queries would have to run inside `withTenant`, or under a role that bypasses RLS on the most sensitive tables.
  - The device limit, the reuse-detecting rotation above and impersonation semantics would be custom plugins anyway.

  The parts it would save us are the small ones; the parts we would fight are the security-critical ones.

- **JWT access tokens + refresh token** (the earlier 03-architecture wording). Rejected: device sign-out, the device limit and the 30-minute impersonation cap all need immediate revocation, so the DB lookup stays. JWTs would add signing-key management, algorithm pitfalls and up to 15 minutes of revocation lag.

## Consequences

- We own security-critical code. Every auth PR needs two reviewers ([04-quality §5](../plan/04-quality.md#5-security-plan)), and track S reviews the merged result before Phase 1 exits.
- Risk **R2** ("Better Auth doesn't fit tenant-scoped phone auth") is closed. The fallback in 03-architecture §4 is now the plan. Its "access JWT + refresh token" wording and DEVELOPMENT.md §0 #2 are superseded by this ADR.
- New contract work for the lead: the refresh endpoint, the AUTH-03 device-choice field, and an impersonation flag in the session response.
- Argon2id at the Saturday peak (4,000 logins in 2 minutes per cell) costs roughly one to two CPU cores of hashing. Size `UV_THREADPOOL_SIZE` and app nodes with the k6 test.

## Security notes

- Tests: token hashing and lookup; rotation, the grace window and reuse revocation; expiry at 12 h and 30 days; a tenant-A cookie on tenant B's host → 401; device limit (J-01); password change revokes everything; impersonation expires at 30 min (J-11); an unknown phone runs the dummy verify.
- Logs redact `cookie`, `set-cookie`, `authorization` and `password` fields. Auth responses send `Cache-Control: no-store`.
- Device limits raise the cost of account sharing; they don't make it impossible, because cookies can be copied. T2 also relies on watermarks and Zoom name lock.

## Addendum (2026-10-03) — SMS one-time codes

Settles the OTP half of AUTH-02 / AUTH-05 / AUTH-09 for Phase 2. The numbers are `OTP_RULES` and `LOGIN_LIMITS` in `packages/types/src/api/auth.ts`; if they change there, this section changes with them.

- **Code:** 6 digits from `crypto.randomInt`, per purpose (`password_reset`, `first_password`, `unlock`). A new code for the same phone and purpose invalidates the previous one.
- **Lifetime and guesses:** valid for 10 minutes; 5 wrong guesses burn the code (the user must request a new one). A used code is deleted, never reusable.
- **Sending limits:** a new code no sooner than 45 s after the last, at most 3 per phone per 15 minutes. Counted by the Valkey limiter and enforced before anything is queued, with per-IP and per-tenant quotas on top (SMS-fraud risk T7). These limits fail **closed** if Valkey is down: no code is sent.
- **Storage:** only `HMAC-SHA-256(server secret, tenantId | phone | purpose | code)` is stored, compared with `crypto.timingSafeEqual`. The key is a dedicated server secret, not the session secret. A 6-digit code has too little entropy for a plain hash to survive a database dump; the HMAC key is what makes offline guessing impossible.
- **Numbers:** only Sri Lankan mobiles `+947XXXXXXXX` (`sriLankaMobile`) can receive codes; anything else is rejected at validation before any send.
- **No enumeration:** the request endpoints always answer 202 with the same body and similar timing whether or not the phone has an account, and whether or not a send was suppressed by a limit. The limiter counts the phone regardless of existence.
- **Development:** the mock SMS provider logs each message (including the code) and keeps it in its call recorder so developers and e2e tests can read it. It is never bound when `NODE_ENV=production`.
