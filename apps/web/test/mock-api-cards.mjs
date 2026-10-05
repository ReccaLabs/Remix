// DEV/TEST ONLY. STU-06 lifecycle matches the real card API; stores never cross tenants.
import { randomUUID } from 'node:crypto';
import { can, storeFor as peopleStoreFor } from './mock-api-people.mjs';
const stores = new Map();
const limits = new Map();
const normal = input => input.replace(/\s+/g, '').toUpperCase();
export async function handleCards(env) {
  const {
    req,
    res,
    pathname,
    tenantOf,
    currentSession,
    USERS,
    json,
    problem,
    readJson,
    csrfRejected,
  } = env;
  const studentPath = /^\/api\/v1\/admin\/students\/([^/]+)\/cards$/.exec(pathname);
  const mutation = /^\/api\/v1\/admin\/cards\/([^/]+)\/(activate|revoke)$/.exec(pathname);
  const ordered = pathname === '/api/v1/admin/cards/ordered';
  const lookup = pathname === '/api/v1/admin/cards/lookup';
  if (!studentPath && !mutation && !ordered && !lookup) return false;
  const tenant = tenantOf(req);
  if (!tenant) return (problem(res, 404, 'TENANT_NOT_FOUND'), true);
  const current = currentSession(req, tenant);
  if (!current) return (problem(res, 401, 'UNAUTHENTICATED'), true);
  const user = USERS.find((u) => u.id === current.session.userId);
  const permission = lookup || ordered || req.method === 'GET' ? 'students.read' : 'students.write';
  if (user?.kind !== 'staff' || !can(user.roles, permission))
    return (problem(res, 403, 'FORBIDDEN'), true);
  if (tenant.status === 'suspended' || tenant.status === 'cancelled')
    return (problem(res, 403, 'TENANT_UNAVAILABLE'), true);
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'GET' && csrfRejected(req)) return (problem(res, 403, 'CSRF_REJECTED'), true);
  if (!stores.has(tenant.slug)) stores.set(tenant.slug, []);
  const cards = stores.get(tenant.slug);
  const students = peopleStoreFor(tenant, env).students;
  const present = ({ uid, ...card }) => ({
    ...card,
    nfcUidHint: uid ? '\u2022\u2022\u2022\u2022' + uid.slice(-4) : null,
  });
  const retire = (card) => {
    card.status = 'revoked';
    card.revokedAt = new Date().toISOString();
    card.revokeReason = 'replaced';
  };
  const replace = (id) =>
    cards.filter((c) => c.studentId === id && c.status === 'active').forEach(retire);
  const only = (body, keys) =>
    body && typeof body === 'object' && Object.keys(body).every((k) => keys.includes(k));
  if (ordered) {
    if (req.method !== 'GET') return (problem(res, 405, 'METHOD_NOT_ALLOWED'), true);
    json(res, 200, {
      items: cards
        .filter((c) => c.status === 'ordered')
        .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))
        .map((c) => ({
          id: c.id,
          code: c.code,
          formats: c.formats,
          issuedAt: c.issuedAt,
          studentId: c.studentId,
          studentNo: students.get(c.studentId).studentNo,
          displayName: students.get(c.studentId).displayName,
        })),
    });
    return true;
  }
  if (lookup) {
    if (req.method !== 'POST') return (problem(res, 405, 'METHOD_NOT_ALLOWED'), true);
    const key = current.session.id ?? current.session.userId;
    const now = Date.now();
    let limit = limits.get(key);
    if (!limit || now > limit.until) {
      limit = { until: now + 60000, count: 0 };
      limits.set(key, limit);
    }
    if (++limit.count > 60) {
      res.setHeader('retry-after', '60');
      return (problem(res, 429, 'RATE_LIMITED'), true);
    }
    const body = await readJson(req);
    if (!only(body, ['input']) || typeof body.input !== 'string')
      return (problem(res, 400, 'VALIDATION_FAILED'), true);
    const input = body.input.replace(/\s/g, '').toUpperCase();
    let card = cards.find((c) => c.code === input);
    let student = card && students.get(card.studentId);
    let matchedBy = 'card';
    if (!student) {
        student = [...students.values()].find((s) => normal(s.studentNo) === input);
      matchedBy = 'studentNo';
    }
    if (!student && /^[0-9A-F]{8,20}$/.test(input)) {
      card = cards.find((c) => c.uid === input);
      student = card && students.get(card.studentId);
      matchedBy = 'nfc';
    }
    if (!student) return (problem(res, 404, 'NOT_FOUND'), true);
    json(res, 200, {
      matchedBy,
      card: card ? { id: card.id, kind: card.kind, status: card.status } : null,
      student: {
        id: student.id,
        studentNo: student.studentNo,
        displayName: student.displayName,
        archived: student.status === 'archived',
      },
    });
    return true;
  }
  if (studentPath) {
    const student = students.get(studentPath[1]);
    if (!student) return (problem(res, 404, 'NOT_FOUND'), true);
    if (req.method === 'GET') {
      json(res, 200, {
        items: cards
          .filter((c) => c.studentId === student.id)
          .reverse()
          .map(present),
      });
      return true;
    }
    if (req.method !== 'POST') return (problem(res, 405, 'METHOD_NOT_ALLOWED'), true);
    const body = await readJson(req);
    if (student.status === 'archived') return (problem(res, 400, 'VALIDATION_FAILED'), true);
    if (!/^[!-~]{3,60}$/.test(normal(student.studentNo))) return (problem(res, 400, 'VALIDATION_FAILED'), true);
    const temporary = body.kind === 'temporary';
    const formats = temporary ? ['barcode'] : body.formats;
    if (
      !only(body, temporary ? ['kind'] : ['kind', 'formats']) ||
      !['temporary', 'permanent'].includes(body.kind) ||
      !Array.isArray(formats) ||
      !formats.includes('barcode') ||
      formats.length > 3 ||
      new Set(formats).size !== formats.length ||
      formats.some((f) => !['barcode', 'qr', 'nfc'].includes(f))
    )
      return (problem(res, 400, 'VALIDATION_FAILED'), true);
    if (!temporary && cards.some((c) => c.studentId === student.id && c.status === 'ordered'))
      return (problem(res, 409, 'CONFLICT'), true);
    const sequence = cards.filter((c) => c.studentId === student.id).length + 1;
    const now = new Date().toISOString();
    if (temporary) replace(student.id);
    const card = {
      id: randomUUID(),
      studentId: student.id,
      code: `${normal(student.studentNo)}-${sequence}`,
      kind: body.kind,
      formats,
      uid: null,
      status: temporary ? 'active' : 'ordered',
      issuedAt: now,
      activatedAt: temporary ? now : null,
      revokedAt: null,
      revokeReason: null,
    };
    cards.push(card);
    json(res, 201, present(card));
    return true;
  }
  if (req.method !== 'POST') return (problem(res, 405, 'METHOD_NOT_ALLOWED'), true);
  const card = cards.find((c) => c.id === mutation[1]);
  if (!card) return (problem(res, 404, 'NOT_FOUND'), true);
  const body = await readJson(req);
  if (mutation[2] === 'revoke') {
    if (
      !only(body, ['reason']) ||
      typeof body.reason !== 'string' ||
      body.reason.trim().length < 3 ||
      body.reason.length > 200
    )
      return (problem(res, 400, 'VALIDATION_FAILED'), true);
    if (card.status === 'revoked') return (problem(res, 409, 'CONFLICT'), true);
    retire(card);
    card.revokeReason = body.reason.trim();
  } else {
    if (!only(body, ['nfcUid']) || (body.nfcUid !== undefined && typeof body.nfcUid !== 'string'))
      return (problem(res, 400, 'VALIDATION_FAILED'), true);
    if (card.status !== 'ordered') return (problem(res, 409, 'CONFLICT'), true);
    const uid = body.nfcUid?.replace(/[\s:-]/g, '').toUpperCase();
    if (uid && (!card.formats.includes('nfc') || !/^[0-9A-F]{8,20}$/.test(uid)))
      return (problem(res, 400, 'VALIDATION_FAILED'), true);
    if (uid && cards.some((c) => c.uid === uid)) return (problem(res, 409, 'CONFLICT'), true);
    replace(card.studentId);
    card.status = 'active';
    card.activatedAt = new Date().toISOString();
    card.uid = uid ?? null;
  }
  json(res, 200, present(card));
  return true;
}
