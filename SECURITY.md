# Security policy

ReMix handles student records, fees and bank slips for Sri Lankan tuition institutes. We take reports seriously.

## Reporting a vulnerability

Email **security@remix.lk** with a description, steps to reproduce and the affected URL or component. Please don't open a public GitHub issue.

- We acknowledge reports within 2 working days and aim to fix critical issues within 7 days.
- Please don't access, modify or delete data that isn't yours, run denial-of-service tests, or social-engineer staff or institutes.
- Good-faith research that follows these rules won't be pursued legally.

`https://remix.lk/.well-known/security.txt` carries the same contact.

## In scope

`remix.lk`, `*.remix.lk`, `admin.remix.lk`, `api.remix.lk`, and the code in this repository.

## Engineering baseline

The full checklist is in [DEVELOPMENT.md §5](DEVELOPMENT.md#5-security--full-checklist). Highlights:

- Static marketing site on Cloudflare Pages with strict security headers and CSP (`apps/site/public/_headers`).
- Form endpoints: server-side Turnstile verification, strict Zod validation, same-origin checks, WAF rate limits, no PII in logs.
- Platform: tenant isolation with PostgreSQL Row Level Security, Argon2id, short-lived sessions, 2-device limit, mandatory TOTP for staff, audited impersonation, private file storage with short-lived signed URLs, encrypted integration secrets.
- Supply chain: frozen lockfile, dependency install scripts denied by default (`pnpm-workspace.yaml` → `allowBuilds`), Dependabot, `pnpm audit`, gitleaks and Semgrep in CI.
