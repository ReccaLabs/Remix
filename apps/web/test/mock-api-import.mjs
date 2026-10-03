// Mock of the student import endpoints for apps/web (STU-04 / DAT-01), registered from
// mock-api.mjs. DEV/TEST ONLY — never deployed, never imported by app code.
//
//   POST /api/v1/admin/imports/students/preview   dry run, nothing written
//   POST /api/v1/admin/imports/students/commit    202 + queued job
//   GET  /api/v1/admin/imports/:id                queued → running → done (one step per poll)
//
// Mirrors the API where the wizard depends on it: `students.import` permission (owner/admin),
// strict bodies, 1–5,000 rows, per-row results with the same statuses, duplicates against the
// institute's students and earlier rows, and a job that finishes after two polls. The validation
// is a simplified copy of apps/api/src/modules/imports/row-validator.ts (Node cannot import that
// TypeScript here). Created students are added to the people mock's store.
import { randomUUID } from 'node:crypto';
import { storeFor } from './mock-api-people.mjs';

const IMPORTERS = new Set(['owner', 'admin']);
const MAX_ROWS = 5000;
const FIELDS = [
  'displayName',
  'phone',
  'studentNo',
  'school',
  'alYear',
  'medium',
  'under18',
  'consentGivenBy',
  'guardianName',
  'guardianRelation',
  'guardianPhone',
  'classes',
];

/** slug → Map(jobId → job) */
const jobs = new Map();

const sriMobile = (value) => {
  const digits = String(value ?? '').replace(/[\s\-().]/g, '');
  return /^(?:\+94|0094|94|0)?7\d{8}$/.test(digits) ? `+94${digits.slice(-9)}` : null;
};

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 12_000_000) return undefined;
  }
  try {
    return JSON.parse(raw || 'null');
  } catch {
    return undefined;
  }
}

function validBody(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.rows)) return false;
  if (body.rows.length < 1 || body.rows.length > MAX_ROWS) return false;
  return body.rows.every(
    (row) =>
      row &&
      typeof row === 'object' &&
      Object.entries(row).every(
        ([k, v]) => FIELDS.includes(k) && typeof v === 'string' && v.length <= 500,
      ),
  );
}

/** Per-row results + the parsed `ok` rows. */
function check(rows, store, classes) {
  const taken = new Map([...store.students.values()].map((s) => [s.phone, s.studentNo]));
  const seen = new Map();
  const byName = new Map(Object.values(classes).map((c) => [c.name.toLowerCase(), c.id]));
  const results = [];
  const valid = [];
  rows.forEach((row, i) => {
    const rowNo = i + 1;
    const errors = [];
    const name = (row.displayName ?? '').trim();
    if (!name) errors.push({ field: 'displayName', message: 'Name is required' });
    const phone = sriMobile(row.phone);
    if (!phone) {
      errors.push({
        field: 'phone',
        message: row.phone
          ? 'Enter a Sri Lankan mobile number, e.g. 077 123 4567'
          : 'Phone is required',
      });
    }
    let duplicateOf = null;
    if (phone) {
      if (seen.has(phone)) duplicateOf = { studentNo: null, rowNo: seen.get(phone) };
      else {
        seen.set(phone, rowNo);
        if (taken.has(phone)) duplicateOf = { studentNo: taken.get(phone), rowNo: null };
      }
    }
    const under18 = /^(yes|y|true|1)$/i.test((row.under18 ?? '').trim());
    if (under18 && !(row.consentGivenBy ?? '').trim()) {
      errors.push({
        field: 'consentGivenBy',
        message: 'Parental consent is required for students under 18',
      });
    }
    const classIds = [];
    for (const part of (row.classes ?? '').split(';').map((p) => p.trim()).filter(Boolean)) {
      const found = byName.get(part.toLowerCase());
      if (found) classIds.push(found);
      else errors.push({ field: 'classes', message: `No class named "${part}"` });
    }
    const status = duplicateOf ? 'duplicate' : errors.length ? 'error' : 'ok';
    results.push({ rowNo, status, errors, duplicateOf });
    if (status === 'ok') valid.push({ row, phone, name, under18, classIds });
  });
  const count = (s) => results.filter((r) => r.status === s).length;
  return {
    results,
    valid,
    summary: {
      total: rows.length,
      ok: count('ok'),
      errors: count('error'),
      duplicates: count('duplicate'),
    },
  };
}

const view = (job) => ({
  id: job.id,
  status: job.status,
  createdAt: job.createdAt,
  finishedAt: job.finishedAt,
  summary: job.status === 'done' ? job.summary : null,
  created: job.status === 'done' ? job.created : null,
  enrolled: job.status === 'done' ? job.enrolled : null,
  rows: job.status === 'done' ? job.results : null,
});

export async function handleImport(env) {
  const { req, res, pathname, json, problem, csrfRejected, tenantOf, currentSession, USERS } = env;
  const route = /^\/api\/v1\/admin\/imports\/(?:students\/(preview|commit)|([^/]+))$/.exec(pathname);
  if (!route) return false;
  const [, action, id] = route;
  const method = req.method ?? 'GET';

  const tenant = tenantOf(req);
  if (!tenant) return (problem(res, 404, 'TENANT_NOT_FOUND'), true);
  const current = currentSession(req, tenant);
  if (!current) return (problem(res, 401, 'UNAUTHENTICATED'), true);
  const user = USERS.find((u) => u.id === current.session.userId);
  if (user.kind !== 'staff' || !user.roles.some((r) => IMPORTERS.has(r))) {
    return (problem(res, 403, 'FORBIDDEN'), true);
  }
  const store = storeFor(tenant, env);
  const mine = jobs.get(tenant.slug) ?? new Map();
  jobs.set(tenant.slug, mine);

  if (id) {
    if (method !== 'GET') return (problem(res, 405, 'METHOD_NOT_ALLOWED'), true);
    const job = mine.get(id);
    if (!job) return (problem(res, 404, 'NOT_FOUND'), true);
    job.polls += 1;
    if (job.status === 'queued') job.status = 'running';
    else if (job.status === 'running' && job.polls >= 2) finish(job, store, env.CLASSES);
    json(res, 200, view(job));
    return true;
  }

  if (method !== 'POST') return (problem(res, 405, 'METHOD_NOT_ALLOWED'), true);
  if (csrfRejected(req, res)) return true;
  const body = await readBody(req);
  if (!validBody(body)) return (problem(res, 400, 'VALIDATION_FAILED'), true);

  if (action === 'preview') {
    const { results, summary } = check(body.rows, store, env.CLASSES);
    json(res, 200, { summary, rows: results });
    return true;
  }

  const job = {
    id: randomUUID(),
    status: 'queued',
    createdAt: new Date().toISOString(),
    finishedAt: null,
    rows: body.rows,
    welcome: body.sendWelcomeSms === true,
    polls: 0,
  };
  mine.set(job.id, job);
  json(res, 202, view(job));
  return true;
}

function finish(job, store, classes) {
  const { results, valid, summary } = check(job.rows, store, classes);
  let enrolled = 0;
  for (const { row, phone, name, under18, classIds } of valid) {
    store.counter += 1;
    enrolled += classIds.length;
    const id = randomUUID();
    store.students.set(id, {
      id,
      studentNo: row.studentNo?.trim() || `IM-${String(store.counter).padStart(4, '0')}`,
      displayName: name,
      phone,
      school: row.school?.trim() || null,
      alYear: row.alYear ? Number(row.alYear) : null,
      medium: row.medium?.trim().toLowerCase() || null,
      status: 'invited',
      under18,
      consent: under18
        ? {
            givenBy: row.consentGivenBy.trim(),
            method: 'paper_form',
            recordedAt: new Date().toISOString(),
          }
        : null,
      guardians: [],
      classIds,
      devices: [],
      joinedAt: new Date().toISOString(),
    });
  }
  Object.assign(job, {
    status: 'done',
    finishedAt: new Date().toISOString(),
    summary,
    results,
    created: valid.length,
    enrolled,
    rows: null,
  });
}
