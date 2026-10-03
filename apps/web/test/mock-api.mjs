// Stand-in for apps/api on :4000 so apps/web runs end to end before the real API lands.
// DEV/TEST ONLY — never deployed, never imported by app code. Run: `pnpm --filter @remix/web mock-api`.
//
// Implements the Phase 1 contract (packages/types/src/api/routes.ts) for the seed hosts:
//   GET  /api/v1/tenant                 TEN-01
//   POST /api/v1/auth/student/login     AUTH-01
//   POST /api/v1/auth/staff/login       AUTH-05 basic
//   GET  /api/v1/auth/session
//   POST /api/v1/auth/session/refresh   rotation ≥ 15 min, 120 s grace (ADR 0004)
//   POST /api/v1/auth/logout            always 204
//   GET  /api/v1/me/classes
//   GET  /api/v1/_debug/headers         echoes the request headers (forwarding checks)
//   + Phase 2 auth (SMS codes, device limit, 2-step, invites, Me): see mock-api-auth.mjs
//
// Behaves like the API where the web app depends on it: tenant from X-Forwarded-Host, host-only
// `remix_session` cookie `<unixSeconds>.<random>` (plain-HTTP dev name), problem+json errors with
// stable codes, ADR 0003 CSRF guard on unsafe methods, a small login rate limit with Retry-After,
// TEN-06 status rules. Sessions live in memory and vanish on restart.
//
// Env: MOCK_API_PORT (4000) · MOCK_TOKEN_BACKDATE_SECONDS (0; e.g. 1000 issues tokens that are
// already due for rotation, to watch the proxy refresh them) · MOCK_LATENCY_MS (0).
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { DEV_INVITE_TOKEN, handleAuthRoute } from './mock-api-auth.mjs';
import { handleImport } from './mock-api-import.mjs';
import { handleClasses, settingsFor } from './mock-api-classes.mjs';
import { handlePeople } from './mock-api-people.mjs';

const PORT = Number(process.env.MOCK_API_PORT ?? 4000);
const BACKDATE = Number(process.env.MOCK_TOKEN_BACKDATE_SECONDS ?? 0);
const LATENCY = Number(process.env.MOCK_LATENCY_MS ?? 0);

/** Every sample account uses this password. Dev only — never a real credential. */
const DEV_PASSWORD = 'remix-dev-only';

const SESSION_COOKIE = 'remix_session';
const DEVICE_COOKIE = 'remix_device';
const ROTATE_AFTER_S = 15 * 60;
const GRACE_S = 120;
const LIFETIME_S = 12 * 3600;
const STAY_LIFETIME_S = 30 * 24 * 3600;

const id = (n) => `0193f1c2-7b1d-7c3e-9a4f-${String(n).padStart(12, '0')}`;

const TENANTS = {
  kamalphysics: {
    id: id(0),
    name: 'Kamal Physics',
    status: 'active',
    plan: 'institute',
    brandColor: '#0F766E',
  },
  royalscience: {
    id: id(1),
    name: 'Royal Science',
    status: 'trial',
    plan: 'tutor',
    brandColor: null,
  },
  closedacademy: {
    id: id(2),
    name: 'Closed Academy',
    status: 'suspended',
    plan: 'tutor',
    brandColor: '#B42318',
  },
};

// Sample people. Same phone at two institutes = two separate accounts (ADR 0004).
const USERS = [
  {
    id: id(101),
    tenant: 'kamalphysics',
    kind: 'student',
    phone: '+94771234567',
    displayName: 'Nimali Perera',
    classes: [id(201), id(202), id(203)],
  },
  {
    id: id(102),
    tenant: 'kamalphysics',
    kind: 'student',
    phone: '+94770000000',
    displayName: 'Disabled Student',
    disabled: true,
    classes: [],
  },
  {
    id: id(103),
    tenant: 'kamalphysics',
    kind: 'student',
    phone: '+94779999999',
    displayName: 'Busy Student',
    deviceLimit: true,
    classes: [],
  },
  {
    id: id(104),
    tenant: 'royalscience',
    kind: 'student',
    phone: '+94771234567',
    displayName: 'Kasun Silva',
    classes: [],
  },
  {
    id: id(111),
    tenant: 'kamalphysics',
    kind: 'staff',
    email: 'kamal@example.com',
    phone: '+94711111111',
    displayName: 'Kamal Jayasinghe',
    roles: ['owner', 'teacher'],
  },
  {
    id: id(112),
    tenant: 'kamalphysics',
    kind: 'staff',
    email: 'dilani@example.com',
    phone: '+94712345678',
    displayName: 'Dilani Fernando',
    roles: ['cashier'],
  },
  {
    id: id(113),
    tenant: 'closedacademy',
    kind: 'staff',
    email: 'owner@example.com',
    phone: '+94713333333',
    displayName: 'Closed Owner',
    roles: ['owner'],
  },
  {
    id: id(114),
    tenant: 'royalscience',
    kind: 'staff',
    email: 'royal@example.com',
    phone: '+94714444444',
    displayName: 'Royal Admin',
    roles: ['admin'],
  },
];

const CLASSES = {
  [id(201)]: {
    id: id(201),
    name: '2027 A/L Physics Theory',
    grade: '2027 A/L',
    medium: 'sinhala',
    teacherName: 'Kamal Jayasinghe',
    feeCents: 250_000,
    place: 'hybrid',
    schedule: [{ weekday: 6, startTime: '08:00', durationMinutes: 180 }],
  },
  [id(202)]: {
    id: id(202),
    name: '2027 A/L Revision',
    grade: '2027 A/L',
    medium: 'english',
    teacherName: 'Kamal Jayasinghe',
    feeCents: 150_000,
    place: 'online',
    schedule: [
      { weekday: 3, startTime: '19:00', durationMinutes: 120 },
      { weekday: 6, startTime: '19:00', durationMinutes: 120 },
    ],
  },
  [id(203)]: {
    id: id(203),
    name: '2027 A/L Paper Class',
    grade: '2027 A/L',
    medium: 'sinhala',
    teacherName: null,
    feeCents: 125_050,
    place: 'hall',
    schedule: [{ weekday: 7, startTime: '14:00', durationMinutes: 150 }],
  },
};

/** token → session. Also indexed by previous token for the rotation grace window. */
const sessions = new Map();
const previous = new Map();
/** `${slug}:${phoneOrEmail}` → failure timestamps (ms). */
const failures = new Map();

const now = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------------------------
// HTTP helpers

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

function json(res, status, body, headers = {}) {
  send(res, status, body, { 'content-type': 'application/json', ...headers });
}

function problem(res, status, code, extra = {}, headers = {}) {
  send(
    res,
    status,
    { type: 'about:blank', title: code, status, code, requestId: res.requestId, ...extra },
    { 'content-type': 'application/problem+json', ...headers },
  );
}

function cookieHeader(name, value, maxAge) {
  // Host-only, HttpOnly, SameSite=Lax, Path=/ — `Secure` and the __Host- prefix only over HTTPS.
  const age = maxAge === undefined ? '' : `; Max-Age=${maxAge}`;
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax${age}`;
}

function readCookie(req, name) {
  for (const pair of String(req.headers.cookie ?? '').split(';')) {
    const eq = pair.indexOf('=');
    if (eq > 0 && pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return null;
}

/** Host the request is for: X-Forwarded-Host (web → API, dev rewrite) or Host. Port stripped. */
function requestHost(req) {
  const raw = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
  if (raw.includes(',')) return null;
  return raw.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

function tenantOf(req) {
  const match = /^([a-z0-9-]+)\.localhost$/.exec(requestHost(req) ?? '');
  return match && Object.hasOwn(TENANTS, match[1])
    ? { slug: match[1], ...TENANTS[match[1]] }
    : null;
}

/** TEN-06, same table as tenantAccess() in @remix/types. */
function access(status) {
  if (status === 'suspended') return { studentPortal: false, staff: 'billing-only' };
  if (status === 'cancelled') return { studentPortal: false, staff: 'none' };
  return { studentPortal: true, staff: 'full' };
}

/** ADR 0003 guard for unsafe methods. Returns true when the request was rejected. */
function csrfRejected(req, res) {
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    problem(res, 403, 'CSRF_REJECTED');
    return true;
  }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    // Dev: scheme http, host + port as the browser sent them (X-Forwarded-Host keeps the port).
    const own = `http://${String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')}`;
    if (origin === 'null' || origin.toLowerCase() !== own.toLowerCase()) {
      problem(res, 403, 'CSRF_REJECTED');
      return true;
    }
  }
  const type = String(req.headers['content-type'] ?? '');
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    problem(res, 415, 'CSRF_REJECTED');
    return true;
  }
  return false;
}

async function readJson(req) {
  // A feature module (mock-api-<area>.mjs) may already have read the body.
  if ('parsedBody' in req) return req.parsedBody;
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_384) return undefined;
  }
  try {
    return JSON.parse(raw || 'null');
  } catch {
    return undefined;
  }
}

function normalisePhone(value) {
  const digits = String(value ?? '').replace(/[\s\-().]/g, '');
  return /^(?:\+94|0094|94|0)?7\d{8}$/.test(digits) ? `+94${digits.slice(-9)}` : null;
}

// ---------------------------------------------------------------------------------------------
// Sessions

function newToken() {
  return `${now() - BACKDATE}.${randomBytes(32).toString('base64url')}`;
}

function sessionBody(s) {
  const user = USERS.find((u) => u.id === s.userId);
  return {
    user: {
      id: user.id,
      tenantId: TENANTS[user.tenant].id,
      kind: user.kind,
      displayName: user.displayName,
      roles: user.kind === 'staff' ? user.roles : [],
      locale: 'en',
    },
    expiresAt: new Date(s.expiresAt * 1000).toISOString(),
    impersonated: false,
  };
}

function sessionCookie(token, s) {
  return cookieHeader(SESSION_COOKIE, token, s.stay ? s.expiresAt - now() : undefined);
}

/** The live session for this request's cookie on this tenant, or null. */
function currentSession(req, tenant) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  let s = sessions.get(token);
  if (!s) {
    // Previous token inside the grace window still works (concurrent navigations, prefetches).
    const prev = previous.get(token);
    if (prev && now() - prev.rotatedAt <= GRACE_S) s = sessions.get(prev.current);
    // Outside the window it means the token was copied: revoke the whole session (reuse).
    else if (prev) {
      sessions.delete(prev.current);
      previous.delete(token);
      console.log('session.reuse_detected', { tenant: tenant?.slug });
      return null;
    }
  }
  if (!s || !tenant || s.tenant !== tenant.slug || s.expiresAt <= now()) return null;
  return { token: sessions.get(token) ? token : null, session: s };
}

function rateLimited(key) {
  const windowMs = 60_000;
  const list = (failures.get(key) ?? []).filter((t) => Date.now() - t < windowMs);
  failures.set(key, list);
  if (list.length < 5) return null;
  return Math.ceil((list[0] + windowMs - Date.now()) / 1000);
}

async function login(req, res, kind) {
  const tenant = tenantOf(req);
  if (!tenant) return problem(res, 404, 'TENANT_NOT_FOUND');
  if (csrfRejected(req, res)) return;

  const allowed = access(tenant.status);
  if (kind === 'student' ? !allowed.studentPortal : allowed.staff === 'none') {
    return problem(res, 403, 'TENANT_UNAVAILABLE');
  }

  const body = await readJson(req);
  const field = kind === 'student' ? 'phone' : 'identifier';
  const known = new Set([field, 'password', 'staySignedIn']);
  if (
    !body ||
    typeof body !== 'object' ||
    Object.keys(body).some((k) => !known.has(k)) ||
    typeof body[field] !== 'string' ||
    typeof body.password !== 'string'
  ) {
    return problem(res, 400, 'VALIDATION_FAILED');
  }

  const raw = body[field].trim();
  const phone = normalisePhone(raw);
  const email = kind === 'staff' && raw.includes('@') ? raw.toLowerCase() : null;
  const key = `${tenant.slug}:${phone ?? email ?? raw}`;
  const wait = rateLimited(key);
  if (wait) return problem(res, 429, 'RATE_LIMITED', {}, { 'retry-after': String(wait) });

  const user = USERS.find(
    (u) =>
      u.tenant === tenant.slug &&
      u.kind === kind &&
      ((phone && u.phone === phone) || (email && u.email === email)),
  );
  // Same answer for an unknown account and a wrong password (no enumeration).
  if (!user || body.password !== DEV_PASSWORD) {
    failures.get(key).push(Date.now());
    return problem(res, 401, 'INVALID_CREDENTIALS');
  }
  if (user.disabled) return problem(res, 403, 'ACCOUNT_DISABLED');
  if (user.deviceLimit) return problem(res, 409, 'DEVICE_LIMIT');

  failures.delete(key);
  const stay = body.staySignedIn === true;
  const s = {
    userId: user.id,
    tenant: tenant.slug,
    stay,
    expiresAt: now() + (stay ? STAY_LIFETIME_S : LIFETIME_S),
  };
  const token = newToken();
  sessions.set(token, s);
  const cookies = [sessionCookie(token, s)];
  if (kind === 'student' && !readCookie(req, DEVICE_COOKIE)) {
    cookies.push(cookieHeader(DEVICE_COOKIE, randomBytes(32).toString('base64url'), 400 * 86_400));
  }
  console.log('login ok', { tenant: tenant.slug, kind, stay });
  return json(res, 200, sessionBody(s), { 'set-cookie': cookies });
}

function refresh(req, res) {
  const tenant = tenantOf(req);
  if (!tenant) return problem(res, 404, 'TENANT_NOT_FOUND');
  if (csrfRejected(req, res)) return;
  const current = currentSession(req, tenant);
  if (!current)
    return problem(
      res,
      401,
      'UNAUTHENTICATED',
      {},
      { 'set-cookie': cookieHeader(SESSION_COOKIE, '', 0) },
    );

  // Grace-window request with the previous token, or a young token: no-op.
  const issuedAt = Number(String(current.token ?? '').split('.')[0]);
  if (!current.token || now() - issuedAt < ROTATE_AFTER_S) {
    return json(res, 200, sessionBody(current.session));
  }
  const token = newToken().replace(/^\d+/, String(now()));
  sessions.delete(current.token);
  sessions.set(token, current.session);
  previous.set(current.token, { current: token, rotatedAt: now() });
  console.log('session rotated', { tenant: tenant.slug });
  return json(res, 200, sessionBody(current.session), {
    'set-cookie': sessionCookie(token, current.session),
  });
}

// ---------------------------------------------------------------------------------------------
// Routes

async function handle(req, res) {
  const { pathname } = new URL(req.url ?? '/', 'http://mock');
  res.requestId = String(req.headers['x-request-id'] ?? randomUUID());
  console.log(req.method, pathname, 'host=', requestHost(req) ?? '-');
  if (LATENCY) await new Promise((r) => setTimeout(r, LATENCY));

  if (pathname === '/api/v1/_debug/headers') return json(res, 200, req.headers);

  const route = `${req.method} ${pathname}`;
  if ((await handleAuthRoute(route, req, res, KIT)) !== false) return;
  switch (route) {
    case 'GET /api/v1/tenant': {
      const t = tenantOf(req);
      if (!t) return problem(res, 404, 'TENANT_NOT_FOUND');
      return json(res, 200, {
        id: t.id,
        slug: t.slug,
        name: settingsFor(t).name,
        status: t.status,
        plan: t.plan,
        defaultLocale: settingsFor(t).defaultLocale,
        timezone: 'Asia/Colombo',
        brandColor: settingsFor(t).brandColor,
        logoUrl: settingsFor(t).logoUrl,
        faviconUrl: settingsFor(t).faviconUrl,
      });
    }

    case 'POST /api/v1/auth/student/login':
      return login(req, res, 'student');

    case 'POST /api/v1/auth/staff/login':
      return login(req, res, 'staff');

    case 'GET /api/v1/auth/session': {
      const tenant = tenantOf(req);
      if (!tenant) return problem(res, 404, 'TENANT_NOT_FOUND');
      const current = currentSession(req, tenant);
      if (!current) return problem(res, 401, 'UNAUTHENTICATED');
      return json(res, 200, sessionBody(current.session));
    }

    case 'POST /api/v1/auth/session/refresh':
      return refresh(req, res);

    case 'POST /api/v1/auth/logout': {
      const tenant = tenantOf(req);
      if (!tenant) return problem(res, 404, 'TENANT_NOT_FOUND');
      if (csrfRejected(req, res)) return;
      const token = readCookie(req, SESSION_COOKIE);
      if (token) sessions.delete(token);
      return send(res, 204, undefined, { 'set-cookie': cookieHeader(SESSION_COOKIE, '', 0) });
    }

    case 'GET /api/v1/me/classes': {
      const tenant = tenantOf(req);
      if (!tenant) return problem(res, 404, 'TENANT_NOT_FOUND');
      if (!access(tenant.status).studentPortal) return problem(res, 403, 'TENANT_UNAVAILABLE');
      const current = currentSession(req, tenant);
      if (!current) return problem(res, 401, 'UNAUTHENTICATED');
      const user = USERS.find((u) => u.id === current.session.userId);
      if (user.kind !== 'student') return problem(res, 403, 'FORBIDDEN');
      return json(res, 200, { items: user.classes.map((c) => CLASSES[c]) });
    }

    default:
      // Phase 2 student import: test/mock-api-import.mjs.
      if (
        await handleImport({ req, res, pathname, json, problem, csrfRejected, tenantOf, currentSession, USERS, CLASSES })
      )
        return;
      // Phase 2 routes: classes, halls, timetable, dashboard, settings (mock-api-classes.mjs),
      // then students and staff (mock-api-people.mjs).
      {
        const feature = {
          req,
          res,
          pathname,
          json,
          send,
          problem,
          readJson,
          csrfRejected,
          tenantOf,
          currentSession,
          USERS,
          CLASSES,
        };
        if ((await handleClasses(feature)) || (await handlePeople(feature))) return;
      }
      return problem(res, 404, 'NOT_FOUND');
  }
}

/** What feature mock modules may use (Phase 2: mock-api-auth.mjs). */
const KIT = {
  TENANTS,
  USERS,
  DEV_PASSWORD,
  LIFETIME_S,
  STAY_LIFETIME_S,
  sessions,
  now,
  send,
  json,
  problem,
  cookieHeader,
  readCookie,
  tenantOf,
  csrfRejected,
  readJson,
  normalisePhone,
  newToken,
  sessionBody,
  sessionCookie,
  currentSession,
};

createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('mock API error', err);
    if (!res.headersSent) problem(res, 500, 'INTERNAL');
  });
}).listen(PORT, () => {
  console.log(`mock API on http://localhost:${PORT}`);
  console.log(
    `dev staff invite: http://kamalphysics.localhost:3001/admin/invite#${DEV_INVITE_TOKEN}`,
  );
});
