# apps/web — tenant sites, student portal, institute admin, platform admin (Phase 1)

Next.js 16 (App Router), Tailwind v4 + `@remix/ui`, shadcn/ui, TanStack Query, react-hook-form + Zod. Not scaffolded yet — this is the agreed structure. Screen → route map: [DESIGN.md §4.2–4.4](../../DESIGN.md#4-screen--route-map).

## How requests reach the right area

`src/proxy.ts` (Next 16 middleware) reads the `Host` header:

| Host | Rewrites to | Area |
| --- | --- | --- |
| `admin.remix.lk` | `/(platform)/…` | Recca Labs staff |
| `<slug>.remix.lk` or a verified custom domain | `/(tenant)/…` with `x-tenant-id` resolved server-side | Institute site, portal, admin |
| anything else | 404 | — |

The tenant is resolved **on the server** from the host (cached lookup keyed by host), never from a query string, cookie or client input.

## Folder structure

```
apps/web/src/
├── proxy.ts                      host → area rewrite, security headers + CSP nonce
├── app/
│   ├── (platform)/               admin.remix.lk — dark sidebar shell, TOTP required
│   │   ├── login/
│   │   ├── (shell)/layout.tsx    requireStaff() guard
│   │   ├── (shell)/page.tsx      overview
│   │   └── (shell)/institutes/[id]/…
│   └── (tenant)/
│       ├── (site)/               public institute website (page-builder blocks)
│       ├── (portal)/             student portal — mobile-first, bottom tab bar
│       │   ├── login/            phone + password / OTP, device limit
│       │   └── app/              home · classes · lessons/[id] · live · pay · me
│       └── admin/                institute admin — light sidebar shell
│           ├── login/
│           └── (shell)/          dashboard · students · classes · lessons · live · fees · attendance
│                                 · website · messages · reports · settings
├── components/
│   ├── shells/                   PlatformShell, AdminShell, PortalShell (TabBar)
│   ├── data/                     DataTable, StatCard, EmptyState, skeletons
│   ├── forms/                    MoneyInput, PhoneInput, MonthPicker, FileDrop…
│   └── features/<domain>/        students/, fees/, lessons/… (screen-specific)
├── server/                       server-only code ('server-only' import)
│   ├── auth/                     session helpers, requireRole(), requireStaff()
│   ├── tenant.ts                 getTenant() from host
│   └── api-client.ts             typed fetch to apps/api with the user's session
├── i18n/                         same pattern as apps/site (namespaces, typed keys)
└── lib/                          formatting (formatLKR, Asia/Colombo dates), utils
```

## Rules specific to this app

- Every server action / route handler re-checks the session and role — UI hiding is not authorization.
- Cookies are host-only (no `Domain=.remix.lk`), `HttpOnly; Secure; SameSite=Lax`.
- CSP with per-request nonces from `proxy.ts`; `frame-ancestors 'none'` except the website-builder preview.
- Tenant brand colour is applied as CSS variables (`--color-brand*`) on `<html>`, validated on save (DESIGN.md §2.2).
- Student routes: < 200 KB JS, no chart libraries.
