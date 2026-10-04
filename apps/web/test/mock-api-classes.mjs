// Mock of the Phase 2 "classes" endpoints for apps/web, registered from mock-api.mjs. DEV/TEST
// ONLY — never deployed, never imported by app code.
//
//   GET/POST  /api/v1/admin/classes                  CLS-01, CLS-02
//   GET/PATCH /api/v1/admin/classes/:id              CLS-03, CLS-02
//   POST      /api/v1/admin/classes/:id/archive
//   GET       /api/v1/admin/classes/:id/students     CLS-03
//   POST      /api/v1/admin/classes/:id/enrollments  CLS-04
//   PATCH     /api/v1/admin/enrollments/:id          CLS-04 (fee override with reason, end month)
//   POST      /api/v1/admin/enrollments/:id/move     CLS-04
//   GET       /api/v1/admin/timetable                CLS-06
//   GET       /api/v1/tenant/timetable               CLS-06 (public, no student counts)
//   GET/POST/PUT/DELETE /api/v1/admin/halls[/:id]    CLS-05 (409 while a class uses the hall)
//   GET       /api/v1/admin/dashboard                counts + today's classes
//   GET/PATCH /api/v1/admin/settings/theme|general   TEN-03 (owner only)
//
// Mirrors the API where the screens depend on it: permissions (same table as
// packages/types/src/permissions.ts, via mock-api-people.mjs), problem+json codes, strict
// bodies, the contrast rule for the brand colour, per-institute in-memory data. Students are
// the people mock's students (`classIds`); enrolment months and fee overrides live here.
import { randomUUID } from 'node:crypto';
import { can, storeFor } from './mock-api-people.mjs';

/** slug → { halls: Map, classes: Map, enrolments: Map<`${studentId}:${classId}`, {…}> } */
const stores = new Map();

const monthOf = (date) => `${date.slice(0, 7)}-01`;
const colomboDate = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const isoWeekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
const mondayOf = (date) => addDays(date, 1 - isoWeekday(date));
function monthBefore(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function storeOf(tenant, env) {
  let store = stores.get(tenant.slug);
  if (store) return store;
  store = { halls: new Map(), classes: new Map(), enrolments: new Map() };
  const hallA = { id: randomUUID(), name: 'Hall A', capacity: 200 };
  const hallB = { id: randomUUID(), name: 'Hall B', capacity: 120 };
  for (const h of tenant.slug === 'kamalphysics' ? [hallA, hallB] : []) store.halls.set(h.id, h);
  const teacher = env.USERS.find((u) => u.tenant === tenant.slug && u.roles?.includes('teacher'));
  for (const c of Object.values(env.CLASSES)) {
    store.classes.set(c.id, {
      id: c.id,
      name: c.name,
      grade: c.grade,
      medium: c.medium,
      teacherId: c.teacherName ? (teacher?.id ?? null) : null,
      feeCents: c.feeCents,
      place: c.place,
      hallId: c.place === 'online' ? null : c.id.endsWith('201') ? hallA.id : hallB.id,
      startsOn: null,
      schedule: c.schedule.map((s) => ({ ...s })),
      archivedAt: null,
    });
  }
  if (tenant.slug !== 'kamalphysics') store.classes.clear();
  stores.set(tenant.slug, store);
  return store;
}

const THEME = new Map();
const themeOf = (tenant) => {
  let theme = THEME.get(tenant.slug);
  if (!theme) {
    theme = { brandColor: tenant.brandColor ?? null, logoUrl: null, faviconUrl: null };
    THEME.set(tenant.slug, theme);
  }
  return theme;
};
const GENERAL = new Map();
const generalOf = (tenant) => {
  let general = GENERAL.get(tenant.slug);
  if (!general) {
    general = { name: tenant.name, defaultLocale: 'en' };
    GENERAL.set(tenant.slug, general);
  }
  return general;
};

/** What GET /api/v1/tenant takes from the saved settings (used by mock-api.mjs). */
export function settingsFor(tenant) {
  return { ...generalOf(tenant), ...themeOf(tenant) };
}

// WCAG contrast of white text on `#rrggbb` (same rule as hasReadableContrast in @remix/types).
function readable(hex) {
  const channel = (i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (lum + 0.05) >= 4.5;
}

const timeOk = (t) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t);
const monthOk = (m) => /^\d{4}-(?:0[1-9]|1[0-2])-01$/.test(m);

/**
 * Handle a classes route. Returns true when the request was answered, false when the route is
 * not one of these (the caller then tries the people mock).
 */
export async function handleClasses(env) {
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
  const m = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://mock');

  const parts = pathname.replace(/^\/api\/v1\//, '').split('/');
  const isPublic = pathname === '/api/v1/tenant/timetable';
  const isAdmin =
    parts[0] === 'admin' &&
    (['classes', 'teachers', 'enrollments', 'timetable', 'halls', 'dashboard'].includes(
      parts[1] ?? '',
    ) ||
      (parts[1] === 'settings' && ['theme', 'general'].includes(parts[2] ?? '')));
  if (!isPublic && !isAdmin) return false;

  const tenant = tenantOf(req);
  if (!tenant) return (problem(res, 404, 'TENANT_NOT_FOUND'), true);
  const store = storeOf(tenant, env);

  if (isPublic) {
    if (tenant.status === 'suspended' || tenant.status === 'cancelled') {
      return (problem(res, 403, 'TENANT_UNAVAILABLE'), true);
    }
    const week = weekParam(url, res, problem);
    if (!week) return true;
    json(res, 200, {
      weekStart: week,
      slots: slotsFor(store, env, tenant, week, null, false),
    });
    return true;
  }

  const current = currentSession(req, tenant);
  if (!current) return (problem(res, 401, 'UNAUTHENTICATED'), true);
  const user = USERS.find((u) => u.id === current.session.userId);
  if (user.kind !== 'staff') return (problem(res, 403, 'FORBIDDEN'), true);
  const roles = user.roles;
  const need = (permission) => can(roles, permission) || (problem(res, 403, 'FORBIDDEN'), false);
  const unsafe = m !== 'GET';
  if (unsafe && csrfRejected(req, res)) return true;
  const body = unsafe ? await readJson(req) : undefined;
  if (unsafe && body === undefined) return (problem(res, 400, 'VALIDATION_FAILED'), true);
  const invalid = (path, message) => (
    problem(res, 400, 'VALIDATION_FAILED', { errors: [{ path, message }] }),
    true
  );
  const notFound = () => (problem(res, 404, 'NOT_FOUND'), true);

  const people = storeFor(tenant, env);
  const month = monthOf(colomboDate());
  const hallName = (id) => store.halls.get(id)?.name ?? null;
  const teacherName = (id) => USERS.find((u) => u.id === id)?.displayName ?? null;
  const enrolmentOf = (studentId, classId) =>
    store.enrolments.get(`${studentId}:${classId}`) ?? {
      fromMonth: '2026-09-01',
      toMonth: null,
      feeOverrideCents: null,
      reason: null,
    };
  const active = (c) =>
    [...people.students.values()].filter(
      (s) => s.status !== 'archived' && s.classIds.includes(c.id),
    );
  const mapClass = (c) => ({
    id: c.id,
    name: c.name,
    grade: c.grade,
    medium: c.medium,
    teacherId: c.teacherId,
    teacherName: teacherName(c.teacherId),
    feeCents: c.feeCents,
    place: c.place,
    hallId: c.hallId,
    hallName: hallName(c.hallId),
    startsOn: c.startsOn,
    schedule: [...c.schedule].sort(
      (a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime),
    ),
    studentCount: active(c).length,
    paidPercent: null,
    archivedAt: c.archivedAt,
  });
  const detail = (c) => {
    const base = mapClass(c);
    return {
      ...base,
      kpis: {
        enrolled: base.studentCount,
        paid: null,
        unpaid: null,
        avgAttendancePercent: null,
      },
    };
  };
  const syncShared = (c) => {
    // The people mock names classes through env.CLASSES.
    env.CLASSES[c.id] = {
      ...(env.CLASSES[c.id] ?? {}),
      id: c.id,
      name: c.name,
      grade: c.grade,
      medium: c.medium,
      feeCents: c.feeCents,
      place: c.place,
      teacherName: teacherName(c.teacherId),
      schedule: c.schedule,
    };
  };

  const [, area, a, b] = parts;

  // ----- settings ------------------------------------------------------------------------
  if (area === 'settings') {
    if (!need('settings.manage')) return true;
    if (a === 'theme') {
      const theme = themeOf(tenant);
      if (m === 'GET') return (json(res, 200, theme), true);
      const allowed = new Set(['brandColor', 'logoUrl', 'faviconUrl']);
      if (Object.keys(body).some((k) => !allowed.has(k))) return invalid('', 'Unknown field');
      if (body.brandColor !== undefined && body.brandColor !== null) {
        if (!/^#[0-9a-fA-F]{6}$/.test(body.brandColor)) return invalid('brandColor', 'Invalid');
        if (!readable(body.brandColor)) {
          return invalid('brandColor', 'Pick a darker colour so white text stays readable');
        }
      }
      for (const key of ['logoUrl', 'faviconUrl']) {
        if (body[key] != null && !/^https:\/\//.test(body[key])) return invalid(key, 'Use https');
      }
      for (const key of allowed) {
        if (body[key] !== undefined) theme[key] = body[key]?.toLowerCase?.() ?? body[key];
      }
      return (json(res, 200, theme), true);
    }
    if (m === 'GET') {
      return (json(res, 200, generalOf(tenant)), true);
    }
    const general = generalOf(tenant);
    const keys = Object.keys(body);
    if (keys.length === 0 || keys.some((k) => !['name', 'defaultLocale'].includes(k))) {
      return invalid('', 'Nothing to update');
    }
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 2 || name.length > 120) return invalid('name', 'Invalid');
      general.name = name;
    }
    if (body.defaultLocale !== undefined) {
      if (!['en', 'si', 'ta'].includes(body.defaultLocale))
        return invalid('defaultLocale', 'Invalid');
      general.defaultLocale = body.defaultLocale;
    }
    return (json(res, 200, general), true);
  }

  if (area === 'teachers' && m === 'GET' && !a) {
    if (!need('classes.write')) return true;
    const items = USERS.filter(
      (u) =>
        u.tenant === tenant.slug &&
        u.kind === 'staff' &&
        (people.staff.get(u.id)?.status ?? 'active') === 'active' &&
        (people.staff.get(u.id)?.roles ?? u.roles)?.includes('teacher'),
    )
      .map((u) => ({ id: u.id, displayName: u.displayName }))
      .sort((x, y) => x.displayName.localeCompare(y.displayName));
    return (json(res, 200, { items }), true);
  }

  // ----- halls ---------------------------------------------------------------------------
  if (area === 'halls') {
    if (m === 'GET' && !a) {
      if (!need('classes.read')) return true;
      return (
        json(res, 200, {
          items: [...store.halls.values()].sort((x, y) => x.name.localeCompare(y.name)),
        }),
        true
      );
    }
    if (!need('classes.write')) return true;
    const checkHall = () => {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 60) return invalid('name', 'Invalid');
      const capacity = body.capacity ?? null;
      if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 5000)) {
        return invalid('capacity', 'Invalid');
      }
      const clash = [...store.halls.values()].some(
        (h) => h.id !== a && h.name.toLowerCase() === name.toLowerCase(),
      );
      if (clash)
        return (
          problem(res, 409, 'CONFLICT', { errors: [{ path: 'name', message: 'Taken' }] }),
          true
        );
      return { name, capacity };
    };
    if (m === 'POST' && !a) {
      const hall = checkHall();
      if (hall === true) return true;
      const created = { id: randomUUID(), ...hall };
      store.halls.set(created.id, created);
      return (json(res, 201, created), true);
    }
    if (a && !store.halls.has(a)) return notFound();
    if (m === 'PUT') {
      const hall = checkHall();
      if (hall === true) return true;
      const updated = { id: a, ...hall };
      store.halls.set(a, updated);
      return (json(res, 200, updated), true);
    }
    if (m === 'DELETE') {
      if ([...store.classes.values()].some((c) => c.hallId === a)) {
        return (problem(res, 409, 'CONFLICT'), true);
      }
      store.halls.delete(a);
      return (send(res, 204, undefined), true);
    }
    return false;
  }

  // ----- dashboard + timetable -------------------------------------------------------------
  if (area === 'dashboard') {
    if (!need('dashboard.view')) return true;
    const list = [...people.students.values()].filter((s) => s.status !== 'archived');
    const today = colomboDate();
    json(res, 200, {
      counts: {
        activeStudents: list.filter((s) => s.status === 'active').length,
        invitedStudents: list.filter((s) => s.status === 'invited').length,
        classes: [...store.classes.values()].filter((c) => !c.archivedAt).length,
        staff: USERS.filter((u) => u.tenant === tenant.slug && u.kind === 'staff').length,
        newStudentsThisMonth: list.filter((s) => s.joinedAt.slice(0, 7) === today.slice(0, 7))
          .length,
      },
      todaysClasses: slotsFor(store, env, tenant, mondayOf(today), null).filter(
        (s) => s.date === today,
      ),
    });
    return true;
  }
  if (area === 'timetable') {
    if (!need('classes.read')) return true;
    const week = weekParam(url, res, problem);
    if (!week) return true;
    return (
      json(res, 200, { weekStart: week, slots: slotsFor(store, env, tenant, week, null) }),
      true
    );
  }

  // ----- enrolments ----------------------------------------------------------------------
  if (area === 'enrollments') {
    if (!need('enrollments.write')) return true;
    const entry = [...store.enrolments.entries()].find(([, e]) => e.id === a);
    if (!entry) return notFound();
    const [key, e] = entry;
    const [studentId, classId] = key.split(':');
    const cls = store.classes.get(classId);
    const toDto = (en, c) => ({
      id: en.id,
      classId: c.id,
      className: c.name,
      fromMonth: en.fromMonth,
      toMonth: en.toMonth,
      feeCents: en.feeOverrideCents ?? c.feeCents,
      feeOverrideCents: en.feeOverrideCents,
      reason: en.reason,
    });
    if (m === 'PATCH' && !b) {
      const keys = Object.keys(body);
      if (
        keys.length === 0 ||
        keys.some((k) => !['feeOverrideCents', 'reason', 'toMonth'].includes(k))
      ) {
        return invalid('', 'Nothing to update');
      }
      if (body.feeOverrideCents != null && !String(body.reason ?? '').trim()) {
        return invalid('reason', 'Give a reason for the fee change');
      }
      if (body.toMonth != null && (!monthOk(body.toMonth) || body.toMonth < e.fromMonth)) {
        return invalid('toMonth', 'Invalid');
      }
      if (body.feeOverrideCents !== undefined) {
        e.feeOverrideCents = body.feeOverrideCents;
        e.reason = body.feeOverrideCents === null ? (body.reason ?? null) : body.reason;
      } else if (body.reason !== undefined) e.reason = body.reason;
      if (body.toMonth !== undefined) e.toMonth = body.toMonth;
      return (json(res, 200, toDto(e, cls)), true);
    }
    if (m === 'POST' && b === 'move') {
      const target = store.classes.get(body.toClassId);
      if (!target || target.archivedAt || target.id === classId) {
        return invalid('toClassId', 'Choose a different class');
      }
      if (!monthOk(body.fromMonth ?? '') || e.fromMonth > body.fromMonth) {
        return invalid('fromMonth', 'Invalid');
      }
      const student = people.students.get(studentId);
      if (student.classIds.includes(target.id)) return (problem(res, 409, 'CONFLICT'), true);
      let next = e;
      if (e.fromMonth === body.fromMonth) store.enrolments.delete(key);
      else {
        e.toMonth = monthBefore(body.fromMonth);
        next = { ...e, id: randomUUID(), fromMonth: body.fromMonth, toMonth: null };
        student.classIds = student.classIds.filter((k) => k !== classId);
      }
      if (e.fromMonth === body.fromMonth) {
        student.classIds = student.classIds.filter((k) => k !== classId);
      }
      student.classIds.push(target.id);
      store.enrolments.set(`${studentId}:${target.id}`, next);
      return (json(res, 200, toDto(next, target)), true);
    }
    return false;
  }

  // ----- classes -------------------------------------------------------------------------
  const readClass = (id) => store.classes.get(id);
  if (!a) {
    if (m === 'GET') {
      if (!need('classes.read')) return true;
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const archived = url.searchParams.get('archived') === 'true';
      const grade = url.searchParams.get('grade');
      const place = url.searchParams.get('place');
      const teacherId = url.searchParams.get('teacherId');
      const items = [...store.classes.values()]
        .filter((c) => Boolean(c.archivedAt) === archived)
        .filter((c) => !q || c.name.toLowerCase().includes(q))
        .filter((c) => !grade || c.grade === grade)
        .filter((c) => !place || c.place === place)
        .filter((c) => !teacherId || c.teacherId === teacherId)
        .sort((x, y) => x.name.localeCompare(y.name))
        .map(mapClass);
      return (json(res, 200, { items }), true);
    }
    if (m === 'POST') {
      if (!need('classes.write')) return true;
      const problemField = checkClass(body, store, USERS, false);
      if (problemField) return invalid(problemField[0], problemField[1]);
      const created = {
        id: randomUUID(),
        name: body.name.trim(),
        grade: body.grade.trim(),
        medium: body.medium,
        teacherId: body.teacherId ?? null,
        feeCents: body.feeCents,
        place: body.place,
        hallId: body.place === 'online' ? null : (body.hallId ?? null),
        startsOn: body.startsOn ?? null,
        schedule: (body.schedule ?? []).map((s) => ({ ...s })),
        archivedAt: null,
      };
      store.classes.set(created.id, created);
      syncShared(created);
      return (json(res, 201, detail(created)), true);
    }
    return false;
  }

  const cls = readClass(a);
  if (!cls) {
    if (!need('classes.read')) return true;
    return notFound();
  }
  if (!b) {
    if (m === 'GET') return need('classes.read') ? (json(res, 200, detail(cls)), true) : true;
    if (m === 'PATCH') {
      if (!need('classes.write')) return true;
      if (Object.keys(body).length === 0) return invalid('', 'Nothing to update');
      const problemField = checkClass({ ...cls, ...body }, store, USERS, true);
      if (problemField) return invalid(problemField[0], problemField[1]);
      for (const key of [
        'name',
        'grade',
        'medium',
        'teacherId',
        'feeCents',
        'place',
        'hallId',
        'startsOn',
      ]) {
        if (body[key] !== undefined)
          cls[key] = typeof body[key] === 'string' ? body[key].trim() : body[key];
      }
      if (cls.place === 'online') cls.hallId = null;
      if (body.schedule) cls.schedule = body.schedule.map((s) => ({ ...s }));
      syncShared(cls);
      return (json(res, 200, detail(cls)), true);
    }
    return false;
  }
  if (b === 'archive' && m === 'POST') {
    if (!need('classes.write')) return true;
    cls.archivedAt ??= new Date().toISOString();
    return (send(res, 204, undefined), true);
  }
  if (b === 'students' && m === 'GET') {
    if (!need('classes.read')) return true;
    const items = active(cls)
      .map((s) => {
        const en = enrolmentOf(s.id, cls.id);
        return {
          enrollmentId: en.id ?? (en.id = randomUUID()),
          studentId: s.id,
          studentNo: s.studentNo,
          displayName: s.displayName,
          phone: s.phone,
          fromMonth: en.fromMonth,
          toMonth: en.toMonth,
          feeCents: en.feeOverrideCents ?? cls.feeCents,
          feeOverrideCents: en.feeOverrideCents,
          reason: en.reason,
        };
      })
      .filter((s) => !s.toMonth || s.toMonth >= month)
      .sort((x, y) => x.displayName.localeCompare(y.displayName));
    // Remember the generated ids so a later PATCH finds the enrolment.
    for (const it of items) {
      const key = `${it.studentId}:${cls.id}`;
      if (!store.enrolments.has(key)) {
        store.enrolments.set(key, {
          id: it.enrollmentId,
          fromMonth: it.fromMonth,
          toMonth: it.toMonth,
          feeOverrideCents: it.feeOverrideCents,
          reason: it.reason,
        });
      }
    }
    return (json(res, 200, { items }), true);
  }
  if (b === 'enrollments' && m === 'POST') {
    if (!need('enrollments.write')) return true;
    if (cls.archivedAt) return invalid('classId', 'Archived classes cannot take new students');
    if (!monthOk(body.fromMonth ?? '')) return invalid('fromMonth', 'Invalid');
    if (body.feeOverrideCents != null && !String(body.reason ?? '').trim()) {
      return invalid('reason', 'Give a reason for the fee change');
    }
    let enrolled = 0;
    const skipped = [];
    for (const id of [...new Set(body.studentIds ?? [])]) {
      const s = people.students.get(id);
      if (!s || s.status === 'archived' || s.classIds.includes(cls.id)) {
        skipped.push(id);
        continue;
      }
      s.classIds.push(cls.id);
      store.enrolments.set(`${id}:${cls.id}`, {
        id: randomUUID(),
        fromMonth: body.fromMonth,
        toMonth: null,
        feeOverrideCents: body.feeOverrideCents ?? null,
        reason: body.feeOverrideCents == null ? null : body.reason,
      });
      enrolled += 1;
    }
    return (json(res, 201, { enrolled, skipped }), true);
  }
  return false;
}

function checkClass(c, store, USERS, partial) {
  if (!partial || c.name !== undefined) {
    if (typeof c.name !== 'string' || !c.name.trim()) return ['name', 'Required'];
    if (typeof c.grade !== 'string' || !c.grade.trim()) return ['grade', 'Required'];
  }
  if (!Number.isInteger(c.feeCents) || c.feeCents < 0) return ['feeCents', 'Invalid'];
  if (c.place === 'online' && c.hallId && !partial)
    return ['hallId', 'Online classes have no hall'];
  if (c.hallId && !store.halls.has(c.hallId)) return ['hallId', 'Choose an existing hall'];
  if (c.teacherId && !USERS.some((u) => u.id === c.teacherId && u.roles?.includes('teacher'))) {
    return ['teacherId', 'Choose a teacher from your staff'];
  }
  const seen = new Set();
  for (const [i, s] of (c.schedule ?? []).entries()) {
    if (!(s.weekday >= 1 && s.weekday <= 7) || !timeOk(s.startTime) || !(s.durationMinutes >= 15)) {
      return [`schedule.${i}.startTime`, 'Invalid'];
    }
    const key = `${s.weekday}@${s.startTime}`;
    if (seen.has(key)) return [`schedule.${i}.startTime`, 'This time is listed twice'];
    seen.add(key);
  }
  return null;
}

function weekParam(url, res, problem) {
  const raw = url.searchParams.get('weekStart');
  if (raw === null) return mondayOf(colomboDate());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || isoWeekday(raw) !== 1) {
    problem(res, 400, 'VALIDATION_FAILED', {
      errors: [{ path: 'weekStart', message: 'A week starts on a Monday' }],
    });
    return null;
  }
  return raw;
}

function slotsFor(store, env, tenant, weekStart, scope, withCounts = true) {
  const people = storeFor(tenant, env);
  const out = [];
  for (const c of store.classes.values()) {
    if (c.archivedAt || (scope && !scope.includes(c.id))) continue;
    for (const s of c.schedule) {
      const date = addDays(weekStart, s.weekday - 1);
      if (c.startsOn && date < c.startsOn) continue;
      out.push({
        classId: c.id,
        className: c.name,
        grade: c.grade,
        teacherName: env.USERS.find((u) => u.id === c.teacherId)?.displayName ?? null,
        hallName: store.halls.get(c.hallId)?.name ?? null,
        place: c.place,
        date,
        startTime: s.startTime,
        durationMinutes: s.durationMinutes,
        ...(withCounts
          ? {
              studentCount: [...people.students.values()].filter(
                (st) => st.status !== 'archived' && st.classIds.includes(c.id),
              ).length,
            }
          : {}),
      });
    }
  }
  return out.sort(
    (x, y) =>
      x.date.localeCompare(y.date) ||
      x.startTime.localeCompare(y.startTime) ||
      x.className.localeCompare(y.className),
  );
}
