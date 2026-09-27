# remix.lk — Cloudflare Pages Functions

Server code for the otherwise static site. Currently one endpoint:

| Route | File | Purpose |
| --- | --- | --- |
| `POST /api/lead` | `api/lead.ts` | Demo / free-trial form on `/demo` → D1 + email to `sales@remix.lk` |

`_lib/` holds helpers (no `onRequest*` exports, so they are not routes). Tests sit next to the
code (`*.test.ts`, Vitest) and are never bundled.

```bash
cd apps/site
npx vitest run functions          # unit tests (fake D1, mocked fetch)
npx tsc --noEmit -p functions     # typecheck with @cloudflare/workers-types
```

## Deploy checklist

1. **Pages project root directory = `apps/site`** (so Cloudflare reads `wrangler.toml` and `functions/`).
   Build command `pnpm --filter @remix/site build`, output `out`.
2. **D1:** `npx wrangler d1 create remix-site-leads --location=weur`, put the id in `wrangler.toml`,
   then `npx wrangler d1 migrations apply remix-site-leads --remote`.
3. **Secrets** (Pages → Settings → Variables and Secrets, type *Secret*, production and preview):
   - `TURNSTILE_SECRET_KEY` — required; without it every lead is rejected (fails closed).
   - `RESEND_API_KEY` — optional; without it leads are stored and the email is skipped (logged).
   Verify `remix.lk` as a sending domain in Resend (SPF/DKIM) for `no-reply@remix.lk`.
4. **Public build var:** `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. In the Turnstile widget settings, allow
   hostnames `remix.lk`, `www.remix.lk` and `remix-site.pages.dev` only (add `localhost` to a
   separate dev widget, not the production one).
5. **Rate limiting (WAF rule)** — see below.

## Rate limiting: Cloudflare WAF rule

The Function does not count requests itself (no shared state). Configure in the Cloudflare
dashboard → Security → WAF → Rate limiting rules:

| Setting | Value |
| --- | --- |
| Name | `remix.lk lead form` |
| Expression | `(http.host in {"remix.lk" "www.remix.lk"} and http.request.uri.path eq "/api/lead")` |
| Characteristics | IP (Free plan: IP only) |
| Rate | Free plan: 3 requests per 10 seconds · Pro and above: 5 requests per 10 minutes |
| Action | Block, for the longest duration the plan allows (10 s on Free, 1 hour on Pro+) |
| Response | Default (429) — the form shows its generic "couldn't send" message with WhatsApp fallback |

Keep Bot Fight Mode on. Turnstile stops automated submissions; the rate limit stops a person (or
a solver farm) from flooding the table and the sales inbox.

## Security properties of `/api/lead`

- `POST` only (others → 405, `Allow: POST`); no CORS headers — same-origin only.
- `Origin` must equal the Function's own origin **and** be `remix.lk`, `www.remix.lk`, `localhost`
  or `*.remix-site.pages.dev`; `Sec-Fetch-Site`, when present, must be `same-origin` → else 403.
- `Content-Type: application/json` (→ 415); body streamed with an 8 KB cap (→ 413); strict UTF-8.
- `leadRequestSchema` from `@remix/types/lead` — strict object (unknown keys → 400), length limits,
  Sri Lankan mobile normalised to `+947XXXXXXXX`, control/bidi characters rejected.
- Turnstile verified server-side (`siteverify`, with `remoteip` from `CF-Connecting-IP`); requires
  `success`, an allowed `hostname` and `action === "lead"` → else 403. Siteverify outage → 500.
- D1 insert with bound parameters only. Raw IP is never stored; only Cloudflare's country code.
- Errors are `{ ok: false, error: "invalid_input" | "verification_failed" | "server_error" }`, with
  `issues: [{ field, code }]` only for validation errors. No stack traces, no provider messages.
- Logs are JSON event names plus the lead id — never names, phone numbers, messages or IPs.
- Every response is `Cache-Control: no-store`.

## Data retention

Leads that don't become customers must be deleted after 24 months (privacy policy draft). Until a
scheduled cleanup exists, run monthly:

```bash
npx wrangler d1 execute remix-site-leads --remote \
  --command "DELETE FROM leads WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 months')"
```
