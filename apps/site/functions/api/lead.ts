/**
 * POST /api/lead — demo / free-trial requests from remix.lk/demo (DEVELOPMENT.md §3.6).
 *
 * Order of checks (cheapest and least trusting first):
 *   1. method is POST                       → 405
 *   2. Origin is this site (same-origin)    → 403 verification_failed
 *   3. Content-Type is application/json     → 415 invalid_input
 *   4. body ≤ 8 KB (streamed, not trusted)  → 413 invalid_input
 *   5. JSON + strict Zod schema             → 400 invalid_input (+ field issues)
 *   6. Turnstile verified server-side       → 403 verification_failed
 *   7. insert into D1 (parameterised)       → 500 server_error
 *   8. notify sales@ by email (best effort, after the response via waitUntil)
 *
 * Rate limiting is NOT done here: a Cloudflare WAF rate-limiting rule on /api/lead limits
 * requests per IP (see functions/README.md). Responses never contain stack traces, and logs
 * contain only the lead id / event names — never names, phone numbers or IPs.
 */
import { leadRequestSchema, type Lead } from '@remix/types/lead';
import { emailProviderFromEnv, type EmailEnv, type EmailProvider } from '../_lib/email';

export interface Env extends EmailEnv {
  DB: D1Database;
  /** Secret — set in Cloudflare Pages env, never in wrangler.toml or the repo. */
  TURNSTILE_SECRET_KEY?: string;
  /** Where lead notifications go. Default sales@remix.lk. */
  LEAD_NOTIFY_TO?: string;
  /** This project's pages.dev host (e.g. remix-site.pages.dev) so preview deploys work. */
  PAGES_PREVIEW_HOST?: string;
}

type ErrorCode = 'invalid_input' | 'verification_failed' | 'server_error';
type FieldIssue = { field: string; code: string };

export const MAX_BODY_BYTES = 8 * 1024;
export const TURNSTILE_ACTION = 'lead';
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SITEVERIFY_TIMEOUT_MS = 5_000;
const PRODUCTION_HOSTS = ['remix.lk', 'www.remix.lk'];
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];
const DEFAULT_NOTIFY_TO = 'sales@remix.lk';

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...headers } });
}

function fail(status: number, error: ErrorCode, extra: { issues?: FieldIssue[] } = {}): Response {
  return json(status, { ok: false, error, ...extra });
}

/** Structured, PII-free log line. */
function log(level: 'info' | 'warn' | 'error', event: string, data: Record<string, string> = {}) {
  console[level](JSON.stringify({ event, ...data }));
}

/** remix.lk, localhost (wrangler pages dev) or this project's *.pages.dev previews. */
export function isAllowedHostname(hostname: string, previewHost?: string): boolean {
  const host = hostname.toLowerCase();
  if (PRODUCTION_HOSTS.includes(host) || LOCAL_HOSTS.includes(host)) return true;
  const preview = previewHost?.trim().toLowerCase();
  return (
    !!preview &&
    preview.endsWith('.pages.dev') &&
    (host === preview || host.endsWith(`.${preview}`))
  );
}

/**
 * CSRF / cross-site abuse guard: the browser's Origin must equal this Function's own origin
 * and be one of our hosts. (Non-browser clients can forge Origin — Turnstile covers those.)
 */
function isSameOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin); // "null" and garbage throw
  } catch {
    return false;
  }
  if (parsed.origin !== new URL(request.url).origin) return false;
  if (!isAllowedHostname(parsed.hostname, env.PAGES_PREVIEW_HOST)) return false;
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  return fetchSite === null || fetchSite === 'same-origin';
}

function isJson(request: Request): boolean {
  const type = request.headers.get('Content-Type') ?? '';
  return type.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

class BodyTooLarge extends Error {}

/** Reads the body as UTF-8 text, aborting as soon as it exceeds `max` bytes. */
async function readBody(request: Request, max: number): Promise<string> {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > max) throw new BodyTooLarge();
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value as Uint8Array;
    total += chunk.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new BodyTooLarge();
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes); // invalid UTF-8 throws
}

type SiteverifyResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
  'error-codes'?: string[];
};

/** Server-side Turnstile check. Throws on network/provider failure (→ 500, not 403). */
async function verifyTurnstile(
  token: string,
  secret: string,
  remoteIp: string | null,
  previewHost: string | undefined,
): Promise<boolean> {
  const form = new URLSearchParams({ secret, response: token });
  if (remoteIp) form.set('remoteip', remoteIp);

  const res = await fetch(SITEVERIFY_URL, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`siteverify_status_${res.status}`);
  const data = (await res.json()) as SiteverifyResponse;

  return (
    data.success === true &&
    typeof data.hostname === 'string' &&
    isAllowedHostname(data.hostname, previewHost) &&
    data.action === TURNSTILE_ACTION
  );
}

function toIssues(issues: ReadonlyArray<{ path: PropertyKey[]; code: string }>): FieldIssue[] {
  return issues.slice(0, 20).map((i) => ({
    // Unknown keys are reported at the root; their names are not echoed back.
    field: typeof i.path[0] === 'string' ? i.path[0] : '',
    code: i.code,
  }));
}

function countryOf(request: Request): string | null {
  const cf = (request as Request & { cf?: { country?: unknown } }).cf;
  const country = cf?.country;
  return typeof country === 'string' && /^[A-Z0-9]{2}$/.test(country) ? country : null;
}

async function storeLead(
  db: D1Database,
  id: string,
  createdAt: string,
  lead: Lead,
  country: string | null,
) {
  await db
    .prepare(
      `INSERT INTO leads (id, created_at, name, phone, whatsapp_same, institute, students, city, message, intent, ip_country)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
    .bind(
      id,
      createdAt,
      lead.name,
      lead.phone,
      lead.whatsappSame ? 1 : 0,
      lead.institute,
      lead.students,
      lead.city,
      lead.message ?? null,
      lead.intent,
      country,
    )
    .run();
}

function notificationEmail(id: string, createdAt: string, lead: Lead, to: string) {
  const kind = lead.intent === 'trial' ? 'Free trial' : 'Demo';
  return {
    to,
    // Single-line fields: the schema already rejects control characters.
    subject: `${kind} request: ${lead.institute}`.slice(0, 150),
    text: [
      `${kind} request from remix.lk`,
      '',
      `Name: ${lead.name}`,
      `Phone: ${lead.phone} (${lead.whatsappSame ? 'WhatsApp on the same number' : 'WhatsApp on a different number'})`,
      `Institute: ${lead.institute}`,
      `Students: ${lead.students}`,
      `City: ${lead.city}`,
      '',
      'Message:',
      lead.message ?? '(none)',
      '',
      `Lead ID: ${id}`,
      `Received: ${createdAt} (UTC)`,
    ].join('\n'),
  };
}

async function notify(
  provider: EmailProvider | null,
  email: ReturnType<typeof notificationEmail>,
  id: string,
) {
  if (!provider) {
    log('warn', 'lead_email_skipped', { leadId: id, reason: 'no_provider' });
    return;
  }
  try {
    await provider.send(email);
    log('info', 'lead_email_sent', { leadId: id, provider: provider.name });
  } catch (err) {
    log('error', 'lead_email_failed', {
      leadId: id,
      provider: provider.name,
      reason: err instanceof Error ? err.message.slice(0, 80) : 'unknown',
    });
  }
}

async function handleLead(
  context: EventContext<Env, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;

  if (!isSameOrigin(request, env)) return fail(403, 'verification_failed');
  if (!isJson(request)) return fail(415, 'invalid_input');

  let raw: string;
  try {
    raw = await readBody(request, MAX_BODY_BYTES);
  } catch (err) {
    return err instanceof BodyTooLarge ? fail(413, 'invalid_input') : fail(400, 'invalid_input');
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, 'invalid_input');
  }

  const parsed = leadRequestSchema.safeParse(body);
  if (!parsed.success) return fail(400, 'invalid_input', { issues: toIssues(parsed.error.issues) });
  const { turnstileToken, ...lead } = parsed.data;

  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    // Fail closed: never accept leads without bot protection.
    log('error', 'lead_config_missing', { key: 'TURNSTILE_SECRET_KEY' });
    return fail(500, 'server_error');
  }

  try {
    const human = await verifyTurnstile(
      turnstileToken,
      secret,
      request.headers.get('CF-Connecting-IP'),
      env.PAGES_PREVIEW_HOST,
    );
    if (!human) {
      log('warn', 'lead_turnstile_rejected');
      return fail(403, 'verification_failed');
    }
  } catch (err) {
    log('error', 'lead_turnstile_unavailable', {
      reason: err instanceof Error ? err.name : 'unknown',
    });
    return fail(500, 'server_error');
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  try {
    await storeLead(env.DB, id, createdAt, lead, countryOf(request));
  } catch (err) {
    // D1 errors don't include bound values; keep the message short anyway.
    log('error', 'lead_store_failed', {
      leadId: id,
      reason: err instanceof Error ? err.message.slice(0, 120) : 'unknown',
    });
    return fail(500, 'server_error');
  }
  log('info', 'lead_created', { leadId: id });

  const email = notificationEmail(
    id,
    createdAt,
    lead,
    env.LEAD_NOTIFY_TO?.trim() || DEFAULT_NOTIFY_TO,
  );
  context.waitUntil(notify(emailProviderFromEnv(env), email, id));

  return json(200, { ok: true });
}

function methodNotAllowed(): Response {
  return json(405, { ok: false, error: 'invalid_input' satisfies ErrorCode }, { Allow: 'POST' });
}

export const onRequestPost: PagesFunction<Env> = (context) => handleLead(context);

/** Every other method (GET, PUT, OPTIONS…) gets 405. No CORS: the form is same-origin only. */
export const onRequest: PagesFunction<Env> = (context) =>
  context.request.method === 'POST' ? handleLead(context) : methodNotAllowed();
