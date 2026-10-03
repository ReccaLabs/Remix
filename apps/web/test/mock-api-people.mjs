// Mock of the Phase 2 "people" endpoints for apps/web (students, guardians, staff and invites),
// registered from mock-api.mjs. DEV/TEST ONLY — never deployed, never imported by app code.
//
//   GET    /api/v1/admin/students            STU-01   (q, classId, status, minDevices, sort, page)
//   POST   /api/v1/admin/students            STU-03
//   GET    /api/v1/admin/students/:id        STU-05
//   PATCH  /api/v1/admin/students/:id        STU-05, PAR-01, PAR-03
//   POST   /api/v1/admin/students/bulk       STU-02, STU-07
//   DELETE /api/v1/admin/students/:id/devices/:deviceId   AUTH-08 (auth track; mocked here)
//   POST   /api/v1/admin/students/:id/password-reset      AUTH-08 (auth track; mocked here)
//   GET    /api/v1/admin/classes             CLS-01 (names only; class track)
//   GET    /api/v1/admin/staff               STF-01/03
//   POST   /api/v1/admin/staff/invites       STF-01, 403 PLAN_LIMIT at the plan's seats
//   DELETE /api/v1/admin/staff/invites/:id
//   PATCH  /api/v1/admin/staff/:id           STF-02, last owner protected
//
// Mirrors the API where the screens depend on it: role permissions (same table as
// packages/types/src/permissions.ts, copied because Node cannot import that TypeScript here),
// problem+json codes, strict bodies, per-institute data. Data lives in memory per tenant and
// resets on restart. Teacher class scoping is not mimicked (no teacher-only sample login).
import { randomUUID } from 'node:crypto';

const ALL = [
  'dashboard.view',
  'students.read',
  'students.write',
  'students.import',
  'students.devices',
  'classes.read',
  'classes.write',
  'enrollments.write',
  'staff.manage',
  'settings.manage',
];
const ROLE_PERMISSIONS = {
  owner: ALL,
  admin: ALL.filter((p) => p !== 'staff.manage' && p !== 'settings.manage'),
  teacher: ['dashboard.view', 'students.read', 'classes.read'],
  cashier: ['dashboard.view', 'students.read', 'classes.read'],
  gatekeeper: ['students.read'],
};
const can = (roles, permission) => roles.some((r) => ROLE_PERMISSIONS[r]?.includes(permission));

const PLAN_SEATS = {
  tutor: { teachers: 1, cashiers: 0 },
  institute: { teachers: null, cashiers: 3 },
};

const FIRST = ['Nimali', 'Kasun', 'Hiruni', 'Tharindu', 'Sanduni', 'Dilshan', 'Kavindi', 'Pasindu'];
const LAST = ['Perera', 'Silva', 'Fernando', 'Herath', 'Senanayake', 'Weerasinghe', 'Dissanayake'];
const SCHOOLS = ["Mahamaya Girls' College", 'Dharmaraja College', 'Kingswood College', null];

/** slug → { students: Map, invites: Map, staffStatus: Map, staffRoles: Map, counter } */
const stores = new Map();

export function storeFor(tenant, env) {
  let store = stores.get(tenant.slug);
  if (store) return store;
  store = { students: new Map(), invites: new Map(), staff: new Map(), counter: 0 };
  const classIds = Object.keys(env.CLASSES);
  const count = tenant.slug === 'kamalphysics' ? 64 : 3;
  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    const first = FIRST[i % FIRST.length];
    const last = LAST[Math.floor(i / FIRST.length) % LAST.length];
    store.counter += 1;
    store.students.set(id, {
      id,
      studentNo: `${tenant.slug === 'kamalphysics' ? 'BR' : 'RS'}-${String(800 + store.counter).padStart(4, '0')}`,
      displayName: `${first} ${last}`,
      phone: `+94712${String(100000 + i * 37).slice(-6)}`,
      school: SCHOOLS[i % SCHOOLS.length],
      alYear: i % 5 === 0 ? null : 2027 + (i % 2),
      medium: i % 3 === 0 ? 'english' : 'sinhala',
      status: i % 17 === 5 ? 'invited' : i % 23 === 7 ? 'archived' : 'active',
      under18: i % 9 === 0,
      consent:
        i % 9 === 0
          ? { givenBy: 'Parent', method: 'paper_form', recordedAt: new Date().toISOString() }
          : null,
      guardians: [
        {
          id: randomUUID(),
          name: `Parent of ${first}`,
          relation: 'mother',
          phone: `+94773${String(100000 + i).slice(-6)}`,
          smsOptIn: true,
        },
      ],
      classIds: i % 11 === 0 ? [] : [classIds[i % classIds.length]],
      devices:
        i % 4 === 0
          ? [mkDevice('iPhone 12 · Safari'), mkDevice('HP Laptop · Chrome')]
          : i % 4 === 1
            ? [mkDevice('Samsung A14 · Chrome')]
            : [],
      joinedAt: new Date(Date.now() - i * 86_400_000 * 3).toISOString(),
    });
  }
  stores.set(tenant.slug, store);
  return store;
}

function mkDevice(label) {
  const now = new Date().toISOString();
  return { id: randomUUID(), label, firstSeenAt: now, lastSeenAt: now };
}

const toItem = (s, env) => ({
  id: s.id,
  studentNo: s.studentNo,
  displayName: s.displayName,
  phone: s.phone,
  school: s.school,
  alYear: s.alYear,
  status: s.status,
  classNames: s.classIds.map((c) => env.CLASSES[c]?.name).filter(Boolean),
  activeDevices: s.devices.length,
  joinedAt: s.joinedAt,
});

const toProfile = (s, env, viewerRoles) => ({
  ...toItem(s, env),
  medium: s.medium,
  under18: s.under18,
  consent: s.consent,
  guardians: s.guardians,
  enrollments: s.classIds.map((c) => ({
    id: randomUUID(),
    classId: c,
    className: env.CLASSES[c].name,
    fromMonth: '2026-09-01',
    toMonth: null,
    feeCents: env.CLASSES[c].feeCents,
    feeOverrideCents: null,
    reason: null,
  })),
  devices: can(viewerRoles, 'students.devices') ? s.devices : [],
  overview: {
    owesCents: null,
    paidThisYearCents: null,
    attendancePercent: null,
    lessonsWatched: null,
  },
  archivedAt: s.status === 'archived' ? new Date().toISOString() : null,
});

const sriMobile = (value) => {
  const digits = String(value ?? '').replace(/[\s\-().]/g, '');
  return /^(?:\+94|0094|94|0)?7\d{8}$/.test(digits) ? `+94${digits.slice(-9)}` : null;
};

function pageOf(items, url) {
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
  const size = [25, 50, 100].includes(Number(url.searchParams.get('pageSize')))
    ? Number(url.searchParams.get('pageSize'))
    : 25;
  return {
    page,
    pageSize: size,
    total: items.length,
    items: items.slice((page - 1) * size, page * size),
  };
}

/**
 * Handle a people route. Returns true when the request was answered, false when the route is not
 * a people route (the caller then answers 404).
 */
export async function handlePeople(env) {
  const {
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
  } = env;
  const url = new URL(req.url ?? '/', 'http://mock');
  const route =
    /^\/api\/v1\/admin\/(students|staff|classes)(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(
      pathname,
    );
  if (!route) return false;
  const [, area, a, b, c] = route;
  const m = req.method ?? 'GET';

  const tenant = tenantOf(req);
  if (!tenant) return (problem(res, 404, 'TENANT_NOT_FOUND'), true);
  const current = currentSession(req, tenant);
  if (!current) return (problem(res, 401, 'UNAUTHENTICATED'), true);
  const user = USERS.find((u) => u.id === current.session.userId);
  if (user.kind !== 'staff') return (problem(res, 403, 'FORBIDDEN'), true);
  const roles = user.roles;
  const need = (permission) => {
    if (can(roles, permission)) return true;
    problem(res, 403, 'FORBIDDEN');
    return false;
  };
  const store = storeFor(tenant, env);
  const unsafe = m !== 'GET';
  if (unsafe && csrfRejected(req, res)) return true;
  const body = unsafe ? await readJson(req) : undefined;
  if (unsafe && body === undefined) return (problem(res, 400, 'VALIDATION_FAILED'), true);

  // ----- classes (names only) -----
  if (area === 'classes' && !a && m === 'GET') {
    if (!need('classes.read')) return true;
    json(res, 200, {
      items: Object.values(env.CLASSES).map((k) => ({
        ...k,
        teacherId: null,
        hallId: null,
        hallName: null,
        startsOn: null,
        studentCount: 0,
        paidPercent: null,
        archivedAt: null,
      })),
    });
    return true;
  }

  // ----- students -----
  if (area === 'students') {
    if (!a && m === 'GET') {
      if (!need('students.read')) return true;
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const status = url.searchParams.get('status');
      const classId = url.searchParams.get('classId');
      const minDevices = Number(url.searchParams.get('minDevices') ?? 0);
      let list = [...store.students.values()].filter((s) =>
        status ? s.status === status : s.status !== 'archived',
      );
      if (q)
        list = list.filter((s) =>
          `${s.displayName} ${s.studentNo} ${s.phone}`.toLowerCase().includes(q),
        );
      if (classId) list = list.filter((s) => s.classIds.includes(classId));
      if (minDevices) list = list.filter((s) => s.devices.length >= minDevices);
      const sort = url.searchParams.get('sort') ?? 'name';
      list.sort((x, y) =>
        sort === 'studentNo'
          ? x.studentNo.localeCompare(y.studentNo)
          : sort === 'joined'
            ? y.joinedAt.localeCompare(x.joinedAt)
            : x.displayName.localeCompare(y.displayName),
      );
      const result = pageOf(list, url);
      json(res, 200, { ...result, items: result.items.map((s) => toItem(s, env)) });
      return true;
    }
    if (!a && m === 'POST') {
      if (!need('students.write')) return true;
      const phone = sriMobile(body.phone);
      if (!body.displayName || !phone)
        return (
          problem(res, 400, 'VALIDATION_FAILED', {
            errors: [{ path: 'phone', message: 'Enter a Sri Lankan mobile number' }],
          }),
          true
        );
      if (body.under18 && !body.consent)
        return (
          problem(res, 400, 'VALIDATION_FAILED', {
            errors: [{ path: 'consent', message: 'Consent required' }],
          }),
          true
        );
      if ([...store.students.values()].some((s) => s.phone === phone))
        return (problem(res, 409, 'CONFLICT'), true);
      store.counter += 1;
      const s = {
        id: randomUUID(),
        studentNo: `${tenant.slug === 'kamalphysics' ? 'BR' : 'RS'}-${String(800 + store.counter).padStart(4, '0')}`,
        displayName: String(body.displayName).trim(),
        phone,
        school: body.school || null,
        alYear: body.alYear ?? null,
        medium: body.medium ?? null,
        status: 'invited',
        under18: Boolean(body.under18),
        consent: body.consent ? { ...body.consent, recordedAt: new Date().toISOString() } : null,
        guardians: (body.guardians ?? []).map((g) => ({
          id: randomUUID(),
          ...g,
          phone: sriMobile(g.phone) ?? g.phone,
          smsOptIn: g.smsOptIn ?? true,
        })),
        classIds: (body.classIds ?? []).filter((k) => env.CLASSES[k]),
        devices: [],
        joinedAt: new Date().toISOString(),
      };
      store.students.set(s.id, s);
      json(res, 201, toProfile(s, env, roles));
      return true;
    }
    if (a === 'bulk' && !b && m === 'POST') {
      if (!need('students.write')) return true;
      const ids = Array.isArray(body.studentIds) ? body.studentIds : [];
      let affected = 0;
      const skipped = [];
      for (const id of ids) {
        const s = store.students.get(id);
        if (!s) {
          skipped.push(id);
          continue;
        }
        if (body.action === 'archive' && s.status !== 'archived') {
          s.status = 'archived';
          s.devices = [];
          affected += 1;
        } else if (body.action === 'reactivate' && s.status === 'archived') {
          s.status = 'active';
          affected += 1;
        } else if (body.action === 'sign_out_devices') {
          if (!can(roles, 'students.devices')) return (problem(res, 403, 'FORBIDDEN'), true);
          if (s.devices.length) {
            s.devices = [];
            affected += 1;
          } else skipped.push(id);
        } else if (
          body.action === 'move_class' &&
          s.classIds.includes(body.fromClassId) &&
          !s.classIds.includes(body.toClassId)
        ) {
          s.classIds = s.classIds.map((k) => (k === body.fromClassId ? body.toClassId : k));
          affected += 1;
        } else skipped.push(id);
      }
      json(res, 200, { affected, skipped });
      return true;
    }
    if (a && !b && (m === 'GET' || m === 'PATCH')) {
      if (!need(m === 'GET' ? 'students.read' : 'students.write')) return true;
      const s = store.students.get(a);
      if (!s) return (problem(res, 404, 'NOT_FOUND'), true);
      if (m === 'PATCH') {
        if (!body || Object.keys(body).length === 0)
          return (problem(res, 400, 'VALIDATION_FAILED'), true);
        if (body.phone) {
          const phone = sriMobile(body.phone);
          if (!phone)
            return (
              problem(res, 400, 'VALIDATION_FAILED', {
                errors: [{ path: 'phone', message: 'Invalid' }],
              }),
              true
            );
          if ([...store.students.values()].some((o) => o.id !== s.id && o.phone === phone))
            return (problem(res, 409, 'CONFLICT'), true);
          s.phone = phone;
        }
        for (const key of ['displayName', 'school', 'alYear', 'medium', 'under18'])
          if (key in body) s[key] = body[key];
        if (body.consent) s.consent = { ...body.consent, recordedAt: new Date().toISOString() };
        if (s.under18 && !s.consent)
          return (
            problem(res, 400, 'VALIDATION_FAILED', {
              errors: [{ path: 'consent', message: 'Consent required' }],
            }),
            true
          );
        if (body.guardians)
          s.guardians = body.guardians.map((g) => ({
            id: randomUUID(),
            ...g,
            phone: sriMobile(g.phone) ?? g.phone,
            smsOptIn: g.smsOptIn ?? true,
          }));
      }
      json(res, 200, toProfile(s, env, roles));
      return true;
    }
    if (a && b === 'devices' && c && m === 'DELETE') {
      if (!need('students.devices')) return true;
      const s = store.students.get(a);
      if (!s) return (problem(res, 404, 'NOT_FOUND'), true);
      s.devices = s.devices.filter((d) => d.id !== c);
      send(res, 204, undefined);
      return true;
    }
    if (a && b === 'password-reset' && m === 'POST') {
      if (!need('students.devices')) return true;
      const s = store.students.get(a);
      if (!s) return (problem(res, 404, 'NOT_FOUND'), true);
      s.devices = [];
      send(res, 204, undefined);
      return true;
    }
    return false;
  }

  // ----- staff -----
  if (area === 'staff') {
    if (!need('staff.manage')) return true;
    const seats = PLAN_SEATS[tenant.plan] ?? PLAN_SEATS.tutor;
    const members = USERS.filter((u) => u.tenant === tenant.slug && u.kind === 'staff').map(
      (u) => ({
        u,
        roles: store.staff.get(u.id)?.roles ?? u.roles,
        status: store.staff.get(u.id)?.status ?? 'active',
        classScope: store.staff.get(u.id)?.classScope ?? [],
      }),
    );
    const used = (role) =>
      members.filter((x) => x.status === 'active' && x.roles.includes(role)).length +
      [...store.invites.values()].filter((i) => i.role === role).length;
    const asMember = (x) => ({
      id: x.u.id,
      displayName: x.u.displayName,
      phone: x.u.phone ?? null,
      email: x.u.email ?? null,
      roles: x.roles,
      classScope: x.classScope,
      status: x.status,
      inviteExpiresAt: null,
      lastSignInAt: null,
    });
    const asInvite = (i) => ({
      id: i.id,
      displayName: i.displayName,
      phone: i.phone ?? null,
      email: i.email ?? null,
      roles: [i.role],
      classScope: i.classScope,
      status: 'invited',
      inviteExpiresAt: i.expiresAt,
      lastSignInAt: null,
    });

    if (!a && m === 'GET') {
      json(res, 200, {
        items: [...members.map(asMember), ...[...store.invites.values()].map(asInvite)],
        usage: {
          teachers: { used: used('teacher'), limit: seats.teachers },
          cashiers: { used: used('cashier'), limit: seats.cashiers },
        },
      });
      return true;
    }
    if (a === 'invites' && !b && m === 'POST') {
      const phone = body.phone ? sriMobile(body.phone) : null;
      if (!body.displayName || !body.role || (!phone && !body.email))
        return (problem(res, 400, 'VALIDATION_FAILED'), true);
      if (['owner', 'admin', 'cashier'].includes(body.role) && !phone)
        return (
          problem(res, 400, 'VALIDATION_FAILED', {
            errors: [{ path: 'phone', message: 'Phone required' }],
          }),
          true
        );
      const taken =
        members.some(
          (x) => (phone && x.u.phone === phone) || (body.email && x.u.email === body.email),
        ) ||
        [...store.invites.values()].some(
          (i) => (phone && i.phone === phone) || (body.email && i.email === body.email),
        );
      if (taken) return (problem(res, 409, 'CONFLICT'), true);
      const seat =
        body.role === 'teacher' ? 'teachers' : body.role === 'cashier' ? 'cashiers' : null;
      if (seat && seats[seat] !== null && used(body.role) >= seats[seat])
        return (problem(res, 403, 'PLAN_LIMIT'), true);
      const invite = {
        id: randomUUID(),
        displayName: body.displayName,
        phone,
        email: body.email ?? null,
        role: body.role,
        classScope: body.role === 'teacher' ? (body.classScope ?? []) : [],
        expiresAt: new Date(Date.now() + 72 * 3_600_000).toISOString(),
      };
      store.invites.set(invite.id, invite);
      json(res, 201, asInvite(invite));
      return true;
    }
    if (a === 'invites' && b && m === 'DELETE') {
      if (!store.invites.delete(b)) return (problem(res, 404, 'NOT_FOUND'), true);
      send(res, 204, undefined);
      return true;
    }
    if (a && a !== 'invites' && !b && m === 'PATCH') {
      const x = members.find((mem) => mem.u.id === a);
      if (!x) return (problem(res, 404, 'NOT_FOUND'), true);
      if (!body || Object.keys(body).length === 0)
        return (problem(res, 400, 'VALIDATION_FAILED'), true);
      const next = {
        roles: body.role ? [body.role] : x.roles,
        status: body.status ?? x.status,
        classScope: body.classScope ?? x.classScope,
      };
      const otherOwners = members.filter(
        (o) => o.u.id !== a && o.status === 'active' && o.roles.includes('owner'),
      ).length;
      if (
        x.status === 'active' &&
        x.roles.includes('owner') &&
        !(next.status === 'active' && next.roles.includes('owner')) &&
        otherOwners === 0
      )
        return (problem(res, 409, 'CONFLICT'), true);
      for (const [seat, role] of [
        ['teachers', 'teacher'],
        ['cashiers', 'cashier'],
      ]) {
        const had = x.status === 'active' && x.roles.includes(role);
        const wants = next.status === 'active' && next.roles.includes(role);
        if (wants && !had && seats[seat] !== null && used(role) >= seats[seat])
          return (problem(res, 403, 'PLAN_LIMIT'), true);
      }
      store.staff.set(a, next);
      json(res, 200, asMember({ ...x, ...next }));
      return true;
    }
  }
  return false;
}
