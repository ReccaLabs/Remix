// Phase 2 auth endpoints for the dev/test mock API (test/mock-api.mjs). DEV/TEST ONLY.
//
//   POST   /api/v1/auth/student/login       (override) "Busy Student" → 403 DEVICE_LIMIT + challenge
//   POST   /api/v1/auth/student/device-limit  sign one device out, finish the login
//   POST   /api/v1/auth/staff/login         (override) owner/admin/cashier → 401 TWO_STEP_REQUIRED
//   POST   /api/v1/auth/staff/two-step      code → session (+ remix_trust cookie when trusted)
//   POST   /api/v1/auth/staff/two-step/resend
//   POST   /api/v1/auth/otp/request         always 202 { resendAfterSeconds: 45 }
//   POST   /api/v1/auth/otp/verify          → { ticket } (null for unlock); 400 CODE_INVALID
//   POST   /api/v1/auth/password/set        204 (the mock keeps accepting the dev password)
//   POST   /api/v1/auth/invite/preview      token printed at startup → preview; 400 INVITE_INVALID
//   POST   /api/v1/auth/invite/accept       → staff session
//   PATCH  /api/v1/me · POST /api/v1/me/password · GET /api/v1/me/devices · DELETE /api/v1/me/devices/:id
//
// Codes are printed to this process's console (like the real dev-only mock SMS provider).
import { randomBytes, randomInt, randomUUID } from 'node:crypto';

const TWO_STEP_ROLES = new Set(['owner', 'admin', 'cashier']);
const TRUST_COOKIE = 'remix_trust';
const RESEND_S = 45;

/** Dev invitation for kamalphysics: open http://kamalphysics.localhost:3001/admin/invite#<token> */
export const DEV_INVITE_TOKEN = randomBytes(32).toString('base64url');

const tickets = new Map(); // token → { kind, userId, tenant, stay, code?, sentAt?, purpose? }
const codes = new Map(); // `${slug}:${phone}:${purpose}` → code
const trusted = new Set(); // trust cookie values
const devices = new Map(); // userId → [{ id, label, firstSeenAt, lastSeenAt }]
let inviteUsed = false;

const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
const token = () => randomBytes(32).toString('base64url');
const masked = (phone) => `+94 ${phone.slice(3, 5)} *** **${phone.slice(-2)}`;
const iso = (s) => new Date(s * 1000).toISOString();

function devicesOf(kit, userId) {
  if (!devices.has(userId)) {
    const t = kit.now();
    devices.set(userId, [
      { id: randomUUID(), label: 'Chrome on Windows', firstSeenAt: iso(t - 9 * 86_400), lastSeenAt: iso(t - 86_400) },
      { id: randomUUID(), label: 'Chrome on Android', firstSeenAt: iso(t - 3 * 86_400), lastSeenAt: iso(t - 3600) },
    ]);
  }
  return devices.get(userId);
}

function signIn(kit, res, user, tenant, stay, extraCookies = []) {
  const s = {
    userId: user.id,
    tenant: tenant.slug,
    stay,
    expiresAt: kit.now() + (stay ? kit.STAY_LIFETIME_S : kit.LIFETIME_S),
  };
  const t = kit.newToken();
  kit.sessions.set(t, s);
  return kit.json(res, 200, kit.sessionBody(s), {
    'set-cookie': [kit.sessionCookie(t, s), ...extraCookies],
  });
}

/** Reads and checks the body of a public POST on a known tenant. */
async function publicBody(kit, req, res) {
  const tenant = kit.tenantOf(req);
  if (!tenant) {
    kit.problem(res, 404, 'TENANT_NOT_FOUND');
    return null;
  }
  if (kit.csrfRejected(req, res)) return null;
  const body = await kit.readJson(req);
  if (!body || typeof body !== 'object') {
    kit.problem(res, 400, 'VALIDATION_FAILED');
    return null;
  }
  return { tenant, body };
}

function findUser(kit, tenant, kind, raw) {
  const phone = kit.normalisePhone(raw);
  const email = typeof raw === 'string' && raw.includes('@') ? raw.trim().toLowerCase() : null;
  return kit.USERS.find(
    (u) =>
      u.tenant === tenant.slug &&
      (!kind || u.kind === kind) &&
      ((phone && u.phone === phone) || (email && u.email === email)),
  );
}

/**
 * Handles the Phase 2 auth routes. Returns false for anything it does not own (including logins
 * it lets the base mock finish), so mock-api.mjs falls through to its own routes.
 */
export async function handleAuthRoute(route, req, res, kit) {
  if (route === 'POST /api/v1/auth/student/login' || route === 'POST /api/v1/auth/staff/login') {
    // Peek at the body without consuming the base handler's copy: re-implement just the
    // challenge cases; everything else goes to the base login.
    const kind = route.includes('/student/') ? 'student' : 'staff';
    const tenant = kit.tenantOf(req);
    if (!tenant || kit.csrfRejected(req, res)) return tenant ? true : false;
    const body = await kit.readJson(req);
    req.parsedBody = body;
    const user = body && findUser(kit, tenant, kind, kind === 'student' ? body.phone : body.identifier);
    if (!user || body.password !== kit.DEV_PASSWORD || user.disabled) return false;
    if (kind === 'student' && user.deviceLimit) {
      const t = token();
      tickets.set(t, { kind: 'device_limit', userId: user.id, tenant: tenant.slug, stay: !!body.staySignedIn });
      return kit.problem(res, 403, 'DEVICE_LIMIT', {
        challenge: { token: t, devices: devicesOf(kit, user.id), expiresAt: iso(kit.now() + 300) },
      });
    }
    const needsCode = kind === 'staff' && user.roles.some((r) => TWO_STEP_ROLES.has(r));
    if (needsCode && !trusted.has(kit.readCookie(req, TRUST_COOKIE))) {
      const t = token();
      const code = newCode();
      tickets.set(t, { kind: 'two_step', userId: user.id, tenant: tenant.slug, stay: !!body.staySignedIn, code, sentAt: kit.now() });
      console.log(`[mock sms] to=${user.phone} 2-step code=${code}`);
      return kit.problem(res, 401, 'TWO_STEP_REQUIRED', {
        challenge: { token: t, maskedPhone: masked(user.phone), resendAfterSeconds: RESEND_S, expiresAt: iso(kit.now() + 600) },
      });
    }
    return false;
  }

  switch (route) {
    case 'POST /api/v1/auth/student/device-limit': {
      const ctx = await publicBody(kit, req, res);
      if (!ctx) return true;
      const ticket = tickets.get(ctx.body.token);
      if (!ticket || ticket.kind !== 'device_limit' || ticket.tenant !== ctx.tenant.slug) {
        return kit.problem(res, 400, 'CODE_INVALID');
      }
      const list = devicesOf(kit, ticket.userId);
      const index = list.findIndex((d) => d.id === ctx.body.signOutDeviceId);
      if (index < 0) return kit.problem(res, 400, 'VALIDATION_FAILED');
      tickets.delete(ctx.body.token);
      list.splice(index, 1);
      const user = kit.USERS.find((u) => u.id === ticket.userId);
      return signIn(kit, res, user, ctx.tenant, ticket.stay);
    }

    case 'POST /api/v1/auth/staff/two-step': {
      const ctx = await publicBody(kit, req, res);
      if (!ctx) return true;
      const ticket = tickets.get(ctx.body.token);
      const code = String(ctx.body.code ?? '').replace(/\s/g, '');
      if (!ticket || ticket.kind !== 'two_step' || ticket.tenant !== ctx.tenant.slug || ticket.code !== code) {
        return kit.problem(res, 400, 'CODE_INVALID');
      }
      tickets.delete(ctx.body.token);
      const extra = [];
      if (ctx.body.trustDevice === true) {
        const value = token();
        trusted.add(value);
        extra.push(kit.cookieHeader(TRUST_COOKIE, value, 30 * 86_400));
      }
      const user = kit.USERS.find((u) => u.id === ticket.userId);
      return signIn(kit, res, user, ctx.tenant, ticket.stay, extra);
    }

    case 'POST /api/v1/auth/staff/two-step/resend': {
      const ctx = await publicBody(kit, req, res);
      if (!ctx) return true;
      const ticket = tickets.get(ctx.body.token);
      if (!ticket || ticket.kind !== 'two_step') return kit.problem(res, 400, 'CODE_INVALID');
      const wait = ticket.sentAt + RESEND_S - kit.now();
      if (wait > 0) return kit.problem(res, 429, 'RATE_LIMITED', {}, { 'retry-after': String(wait) });
      ticket.code = newCode();
      ticket.sentAt = kit.now();
      const user = kit.USERS.find((u) => u.id === ticket.userId);
      console.log(`[mock sms] to=${user.phone} 2-step code=${ticket.code}`);
      return kit.json(res, 200, {
        token: ctx.body.token,
        maskedPhone: masked(user.phone),
        resendAfterSeconds: RESEND_S,
        expiresAt: iso(kit.now() + 600),
      });
    }

    case 'POST /api/v1/auth/otp/request': {
      const ctx = await publicBody(kit, req, res);
      if (!ctx) return true;
      const phone = kit.normalisePhone(ctx.body.phone);
      if (!phone) return kit.problem(res, 400, 'VALIDATION_FAILED');
      const user = findUser(kit, ctx.tenant, null, phone);
      if (user) {
        const code = newCode();
        codes.set(`${ctx.tenant.slug}:${phone}:${ctx.body.purpose}`, code);
        console.log(`[mock sms] to=${phone} ${ctx.body.purpose} code=${code}`);
      }
      // Same answer whether or not the phone has an account.
      return kit.json(res, 202, { resendAfterSeconds: RESEND_S });
    }

    case 'POST /api/v1/auth/otp/verify': {
      const ctx = await publicBody(kit, req, res);
      if (!ctx) return true;
      const phone = kit.normalisePhone(ctx.body.phone);
      const key = `${ctx.tenant.slug}:${phone}:${ctx.body.purpose}`;
      const code = String(ctx.body.code ?? '').replace(/\s/g, '');
      if (!phone || codes.get(key) !== code) return kit.problem(res, 400, 'CODE_INVALID');
      codes.delete(key);
      if (ctx.body.purpose === 'unlock') return kit.json(res, 200, { ticket: null });
      const t = token();
      tickets.set(t, { kind: 'password', tenant: ctx.tenant.slug });
      return kit.json(res, 200, { ticket: t });
    }

    case 'POST /api/v1/auth/password/set': {
      const ctx = await publicBody(kit, req, res);
      if (!ctx) return true;
      const ticket = tickets.get(ctx.body.ticket);
      if (!ticket || ticket.kind !== 'password' || ticket.tenant !== ctx.tenant.slug) {
        return kit.problem(res, 400, 'CODE_INVALID');
      }
      if (String(ctx.body.newPassword ?? '').toLowerCase() === 'password123') {
        return kit.problem(res, 400, 'VALIDATION_FAILED', {
          errors: [{ path: 'newPassword', message: 'This password is too common' }],
        });
      }
      tickets.delete(ctx.body.ticket);
      return kit.send(res, 204);
    }

    case 'POST /api/v1/auth/invite/preview':
    case 'POST /api/v1/auth/invite/accept': {
      const ctx = await publicBody(kit, req, res);
      if (!ctx) return true;
      if (ctx.tenant.slug !== 'kamalphysics' || ctx.body.token !== DEV_INVITE_TOKEN || inviteUsed) {
        return kit.problem(res, 400, 'INVITE_INVALID');
      }
      if (route.endsWith('/preview')) {
        return kit.json(res, 200, {
          tenantName: ctx.tenant.name,
          displayName: 'Invited Teacher',
          role: 'teacher',
          expiresAt: iso(kit.now() + 72 * 3600),
        });
      }
      inviteUsed = true;
      const user = {
        id: randomUUID(),
        tenant: 'kamalphysics',
        kind: 'staff',
        phone: '+94715555555',
        displayName: 'Invited Teacher',
        roles: ['teacher'],
      };
      kit.USERS.push(user);
      return signIn(kit, res, user, ctx.tenant, false);
    }

    default:
      break;
  }

  const meDevice = /^DELETE \/api\/v1\/me\/devices\/([0-9a-f-]{36})$/.exec(route);
  if (route.startsWith('GET /api/v1/me/devices') || route.startsWith('PATCH /api/v1/me') ||
      route === 'POST /api/v1/me/password' || meDevice) {
    const tenant = kit.tenantOf(req);
    if (!tenant) return kit.problem(res, 404, 'TENANT_NOT_FOUND');
    if (req.method !== 'GET' && kit.csrfRejected(req, res)) return true;
    const current = kit.currentSession(req, tenant);
    if (!current) return kit.problem(res, 401, 'UNAUTHENTICATED');
    const user = kit.USERS.find((u) => u.id === current.session.userId);

    if (route === 'GET /api/v1/me/devices') {
      const others = user.kind === 'student' ? devicesOf(kit, user.id).slice(0, 1) : [];
      const t = kit.now();
      return kit.json(res, 200, {
        items: [
          { id: '0193f1c2-7b1d-7c3e-9a4f-cccccccccccc', label: 'This browser', firstSeenAt: iso(t - 600), lastSeenAt: iso(t), current: true },
          ...others.map((d) => ({ ...d, current: false })),
        ],
        limit: user.kind === 'student' ? 2 : null,
      });
    }
    if (meDevice) {
      const list = devicesOf(kit, user.id);
      const index = list.findIndex((d) => d.id === meDevice[1]);
      if (index < 0) return kit.problem(res, 404, 'NOT_FOUND');
      list.splice(index, 1);
      return kit.send(res, 204);
    }
    const body = await kit.readJson(req);
    if (route === 'POST /api/v1/me/password') {
      if (!body || body.currentPassword !== kit.DEV_PASSWORD) {
        return kit.problem(res, 400, 'INVALID_CREDENTIALS');
      }
      return kit.send(res, 204);
    }
    if (!body || !['en', 'si', 'ta'].includes(body.locale)) {
      return kit.problem(res, 400, 'VALIDATION_FAILED');
    }
    return kit.send(res, 204);
  }

  return false;
}
