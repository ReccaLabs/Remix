# apps/api — NestJS API, workers, realtime (Phase 1)

NestJS modular monolith, Drizzle ORM on PostgreSQL 18 with Row Level Security, Valkey + BullMQ for jobs, Socket.io for realtime. Not scaffolded yet — this is the agreed structure. Rules: [DEVELOPMENT.md §4.1 and §5](../../DEVELOPMENT.md).

## Folder structure

```
apps/api/src/
├── main.ts                       helmet, CORS allowlist, body limits, trust proxy (Cloudflare only)
├── app.module.ts
├── common/
│   ├── guards/                   AuthGuard, RolesGuard (deny by default), StaffTotpGuard
│   ├── interceptors/             AuditInterceptor (money/role/settings changes → audit_logs)
│   ├── pipes/                    ZodValidationPipe (schemas from @remix/types, strict objects)
│   ├── filters/                  error filter — no stack traces or SQL in responses
│   └── tenant/                   TenantContext (from verified host/session), withTenant()
├── modules/
│   ├── auth/                     Better Auth integration, sessions, 2-device limit, OTP
│   ├── tenants/                  institutes, domains, plans, feature flags
│   ├── students/ classes/ enrollments/
│   ├── fees/                     invoices, payments, bank-slip queue, cash counter, receipts
│   ├── lessons/                  video (Bunny/YouTube), PDFs, month locking, watermarking
│   ├── live/                     Zoom OAuth, sessions, registrant links, attendance import
│   ├── attendance/               QR/NFC scans, ReMix+ gate sync
│   ├── messages/                 SMS wallet, BYO gateway (SSRF-guarded), notifications
│   ├── website/                  page-builder blocks (data only, never raw HTML)
│   └── platform/                 staff-only: institutes, billing, impersonation (reason + 60 min + audited)
├── integrations/                 provider interfaces + adapters
│   ├── payment/                  PaymentProvider → PayHere (md5sig verify, idempotent notify)
│   ├── sms/                      SmsProvider → Text.lk, BYO gateway
│   ├── video/                    VideoProvider → Bunny Stream (token auth), YouTube
│   ├── meeting/                  MeetingProvider → Zoom
│   └── storage/                  R2 private buckets, signed URLs ≤ 10 min, tenantId/ prefixes
├── jobs/                         BullMQ processors (SMS, receipts, reports, webhooks, PDF watermark)
└── health/                       /health for Kamal deploys
```

Database schema, migrations and the `withTenant()` helper live in `packages/db` (Drizzle). Every tenant table has `tenant_id` + RLS; the app DB role is not the table owner.
