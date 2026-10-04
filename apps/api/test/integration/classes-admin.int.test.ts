import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@remix/db';
import {
  teachersResponseSchema,
  classDetailSchema,
  classStudentsResponseSchema,
  listClassesResponseSchema,
  type StaffRole,
} from '@remix/types/api';
import { expectProblem } from '../fixtures/problem';
import {
  createDbTestApp,
  Factory,
  ownerDb,
  type DbTestApp,
  type TenantFixture,
  type UserFixture,
} from './support/db-app';
import {
  api,
  scopeTeacher,
  signInStaff,
  signInStudent,
  staffByRole,
  type Api,
} from './support/people';

/** One string column of a JSON list in a response body (supertest bodies are untyped). */
const col = (items: unknown, key: string): string[] =>
  (items as Record<string, string>[]).map((item) => item[key] ?? '');

const LIST = '/api/v1/admin/classes';
const one = (id: string) => `${LIST}/${id}`;

describe('admin classes (CLS-01/02/03) against Postgres', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  let tenant: TenantFixture;
  let other: TenantFixture;
  let staff: Record<StaffRole, { user: UserFixture; api: Api }>;
  let hallA: string;
  let foreignHall: string;
  let physics: string;
  let revision: string;
  let online: string;
  let archived: string;
  let foreignClass: string;
  let student: UserFixture;
  let studentCookieApi: Api;

  const owner = () => staff.owner.api;
  const teacherId = () => staff.teacher.user.id;

  const payload = (over: Record<string, unknown> = {}) => ({
    name: '2029 A/L Physics',
    grade: '2029 A/L',
    medium: 'sinhala',
    teacherId: teacherId(),
    feeCents: 250_000,
    place: 'hall',
    hallId: hallA,
    startsOn: '2026-11-01',
    schedule: [
      { weekday: 7, startTime: '08:00', durationMinutes: 180 },
      { weekday: 3, startTime: '19:00', durationMinutes: 120 },
    ],
    ...over,
  });

  beforeAll(async () => {
    t = await createDbTestApp();
    db = ownerDb();
    f = new Factory(db);
    tenant = await f.tenant('active');
    other = await f.tenant('active');
    staff = await staffByRole(t, f, tenant);

    hallA = await f.hall(tenant, 'Hall A', 200);
    foreignHall = await f.hall(other, 'Foreign hall');
    physics = await f.klass(tenant, {
      name: 'Physics Theory',
      feeCents: 250_000,
      teacherId: teacherId(),
      hallId: hallA,
      grade: '2027 A/L',
      schedules: [
        [6, '08:00', 180],
        [3, '19:00', 120],
      ],
    });
    revision = await f.klass(tenant, {
      name: 'Physics Revision',
      feeCents: 150_000,
      grade: '2026 A/L',
    });
    online = await f.klass(tenant, {
      name: 'Online Chemistry',
      feeCents: 100_000,
      place: 'online',
      grade: '2027 A/L',
    });
    archived = await f.klass(tenant, { name: 'Old class', feeCents: 1, archived: true });
    foreignClass = await f.klass(other, { name: 'Foreign class', feeCents: 1 });
    await scopeTeacher(f, staff.teacher.user, [physics]);

    student = await f.student(tenant, { name: 'Nimali Perera' });
    const ended = await f.student(tenant, { name: 'Ended Eve' });
    const gone = await f.student(tenant, { name: 'Archived Ann', archived: true });
    await f.enroll(tenant, student.id, physics, { from: '2026-01-01', feeOverrideCents: 100_000 });
    await f.enroll(tenant, ended.id, physics, { from: '2026-01-01', to: '2026-09-01' });
    await f.enroll(tenant, gone.id, physics, { from: '2026-01-01' });
    await f.enroll(tenant, student.id, revision, { from: '2026-10-01' });

    studentCookieApi = api(
      t,
      tenant.host,
      await signInStudent(t, tenant, await f.student(tenant, { name: 'Portal Student' })),
    );
  });
  afterAll(async () => {
    await t.close();
    await db.$client.end();
  });

  describe('GET /admin/teachers ? CLS-02', () => {
    it('owner and admin see only active staff with the teacher role, including unassigned teachers', async () => {
      const unassigned = await f.staff(tenant, ['teacher'], { name: 'Unassigned Teacher' });
      const disabled = await f.staff(tenant, ['teacher'], { name: 'Disabled Teacher' });
      await db
        .update(schema.tenantUsers)
        .set({ status: 'disabled' })
        .where(eq(schema.tenantUsers.id, disabled.id));
      const invited = await f.staff(tenant, ['teacher'], { name: 'Invited Teacher' });
      await db
        .update(schema.tenantUsers)
        .set({ status: 'invited' })
        .where(eq(schema.tenantUsers.id, invited.id));
      for (const role of ['owner', 'admin'] as const) {
        const res = await staff[role].api.get('/api/v1/admin/teachers');
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        const { items } = teachersResponseSchema.parse(res.body);
        expect(items.map((m) => m.id).sort()).toEqual([teacherId(), unassigned.id].sort());
      }
    });

    it('denies teacher, cashier, gatekeeper, student and anonymous callers', async () => {
      for (const role of ['teacher', 'cashier', 'gatekeeper'] as const) {
        expectProblem(await staff[role].api.get('/api/v1/admin/teachers'), 403, 'FORBIDDEN');
      }
      expectProblem(await studentCookieApi.get('/api/v1/admin/teachers'), 403, 'FORBIDDEN');
      expectProblem(
        await api(t, tenant.host).get('/api/v1/admin/teachers'),
        401,
        'UNAUTHENTICATED',
      );
    });

    it('never returns foreign teachers and refuses a session on a different tenant host', async () => {
      const foreign = await f.staff(other, ['teacher'], { name: 'Foreign Teacher' });
      const otherOwner = await f.staff(other, ['owner']);
      const cookie = await signInStaff(t, other, otherOwner);
      const otherApi = api(t, other.host, cookie);
      const res = await otherApi.get('/api/v1/admin/teachers');
      expect(res.status).toBe(200);
      expect(teachersResponseSchema.parse(res.body).items).toEqual([
        { id: foreign.id, displayName: 'Foreign Teacher' },
      ]);
      expectProblem(
        await api(t, tenant.host, cookie).get('/api/v1/admin/teachers'),
        401,
        'UNAUTHENTICATED',
      );
    });
  });

  describe('GET /admin/classes — CLS-01', () => {
    it('lists non-archived classes in the contract shape, with schedule, teacher, hall and counts', async () => {
      const res = await owner().get(LIST);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = listClassesResponseSchema.strict().parse(res.body);
      expect(body.items.map((c) => c.name)).toEqual([
        'Online Chemistry',
        'Physics Revision',
        'Physics Theory',
      ]);
      const theory = body.items.find((c) => c.id === physics);
      expect(theory).toMatchObject({
        teacherId: teacherId(),
        teacherName: 'teacher user',
        hallId: hallA,
        hallName: 'Hall A',
        feeCents: 250_000,
        place: 'hall',
        // Enrolled this month: Nimali only (one ended, one archived student).
        studentCount: 1,
        paidPercent: null,
        archivedAt: null,
        schedule: [
          { weekday: 3, startTime: '19:00', durationMinutes: 120 },
          { weekday: 6, startTime: '08:00', durationMinutes: 180 },
        ],
      });
      expect(body.items.find((c) => c.id === online)).toMatchObject({
        place: 'online',
        hallName: null,
        teacherName: null,
        schedule: [],
        studentCount: 0,
      });
    });

    it('filters by text, grade, place and teacher; archived=true lists only archived classes', async () => {
      const names = async (query: string) =>
        ((await owner().get(`${LIST}?${query}`)).body.items as { name: string }[]).map(
          (c) => c.name,
        );
      expect(await names('q=revision')).toEqual(['Physics Revision']);
      expect(await names('q=%25')).toEqual([]); // LIKE wildcards are escaped
      expect(await names('grade=2026%20A%2FL')).toEqual(['Physics Revision']);
      expect(await names('place=online')).toEqual(['Online Chemistry']);
      expect(await names(`teacherId=${teacherId()}`)).toEqual(['Physics Theory']);
      expect(await names('archived=true')).toEqual(['Old class']);
      expect(await names('archived=false&place=hall')).toEqual([
        'Physics Revision',
        'Physics Theory',
      ]);
    });

    it('rejects unknown parameters and bad values with 400', async () => {
      expectProblem(await owner().get(`${LIST}?bogus=1`), 400, 'VALIDATION_FAILED');
      expectProblem(await owner().get(`${LIST}?place=moon`), 400, 'VALIDATION_FAILED');
      expectProblem(await owner().get(`${LIST}?teacherId=nope`), 400, 'VALIDATION_FAILED');
    });
  });

  describe('GET /admin/classes/:id — CLS-03', () => {
    it('returns the detail with KPIs that stay null until later phases', async () => {
      const res = await owner().get(one(physics));
      expect(res.status).toBe(200);
      const body = classDetailSchema.strict().parse(res.body);
      expect(body.kpis).toEqual({
        enrolled: 1,
        paid: null,
        unpaid: null,
        avgAttendancePercent: null,
      });
    });

    it('404s for unknown ids, 400s for malformed ones', async () => {
      expectProblem(
        await owner().get(one('0193f1c2-7b1d-7c3e-9a4f-000000000999')),
        404,
        'NOT_FOUND',
      );
      expectProblem(await owner().get(one('not-a-uuid')), 400, 'VALIDATION_FAILED');
    });
  });

  describe('POST /admin/classes — CLS-02', () => {
    it('creates a class with its schedule and audits it', async () => {
      const res = await owner().post(LIST, payload());
      expect(res.status).toBe(201);
      const body = classDetailSchema.strict().parse(res.body);
      expect(body).toMatchObject({
        name: '2029 A/L Physics',
        teacherName: 'teacher user',
        hallName: 'Hall A',
        startsOn: '2026-11-01',
        studentCount: 0,
        schedule: [
          { weekday: 3, startTime: '19:00', durationMinutes: 120 },
          { weekday: 7, startTime: '08:00', durationMinutes: 180 },
        ],
      });
      const [audit] = await f
        .audits(tenant, 'class.create')
        .then((a) => a.filter((r) => r.entityId === body.id));
      expect(audit).toMatchObject({
        actorId: staff.owner.user.id,
        entity: 'class',
        after: { name: '2029 A/L Physics', feeCents: 250_000, slots: 2 },
      });
    });

    it('applies defaults: no teacher, hall, start date or schedule is needed', async () => {
      const res = await owner().post(LIST, {
        name: 'Minimal',
        grade: 'Grade 9',
        medium: 'english',
        feeCents: 0,
        place: 'online',
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        teacherId: null,
        hallId: null,
        startsOn: null,
        schedule: [],
        feeCents: 0,
      });
    });

    it('rejects bad input with 400: unknown fields, online + hall, fees, duplicate slots', async () => {
      const bad = async (body: Record<string, unknown>) =>
        expectProblem(await owner().post(LIST, body), 400, 'VALIDATION_FAILED');
      await bad({ ...payload(), extra: 1 });
      await bad(payload({ place: 'online' })); // hallId given
      await bad(payload({ feeCents: -1 }));
      await bad(payload({ feeCents: 1.5 }));
      await bad(payload({ name: '  ' }));
      await bad(payload({ schedule: [{ weekday: 8, startTime: '08:00', durationMinutes: 60 }] }));
      await bad(payload({ schedule: [{ weekday: 1, startTime: '8:00', durationMinutes: 60 }] }));
      const dup = await owner().post(
        LIST,
        payload({
          schedule: [
            { weekday: 2, startTime: '08:00', durationMinutes: 60 },
            { weekday: 2, startTime: '08:00', durationMinutes: 90 },
          ],
        }),
      );
      expect(expectProblem(dup, 400, 'VALIDATION_FAILED').errors?.[0]?.path).toBe(
        'schedule.1.startTime',
      );
    });

    it("rejects a teacher who is not a teacher of this institute, and another institute's hall", async () => {
      const cashier = await owner().post(LIST, payload({ teacherId: staff.cashier.user.id }));
      expect(expectProblem(cashier, 400, 'VALIDATION_FAILED').errors?.[0]?.path).toBe('teacherId');
      const foreignTeacher = await f.staff(other, ['teacher']);
      expectProblem(
        await owner().post(LIST, payload({ teacherId: foreignTeacher.id })),
        400,
        'VALIDATION_FAILED',
      );
      const hall = await owner().post(LIST, payload({ hallId: foreignHall }));
      expect(expectProblem(hall, 400, 'VALIDATION_FAILED').errors?.[0]?.path).toBe('hallId');
      // A student is no teacher either.
      expectProblem(
        await owner().post(LIST, payload({ teacherId: student.id })),
        400,
        'VALIDATION_FAILED',
      );
    });
  });

  describe('PATCH /admin/classes/:id — CLS-02', () => {
    it('changes fields, replaces the schedule and audits before/after', async () => {
      const id = await f.klass(tenant, {
        name: 'To edit',
        feeCents: 100_000,
        hallId: hallA,
        schedules: [[1, '09:00', 60]],
      });
      const res = await owner().patch(one(id), {
        name: 'Edited',
        feeCents: 120_000,
        schedule: [
          { weekday: 5, startTime: '16:00', durationMinutes: 90 },
          { weekday: 2, startTime: '10:00', durationMinutes: 45 },
        ],
      });
      expect(res.status).toBe(200);
      expect(classDetailSchema.parse(res.body)).toMatchObject({
        name: 'Edited',
        feeCents: 120_000,
        hallName: 'Hall A',
        schedule: [
          { weekday: 2, startTime: '10:00', durationMinutes: 45 },
          { weekday: 5, startTime: '16:00', durationMinutes: 90 },
        ],
      });
      const audits = (await f.audits(tenant, 'class.update')).filter((a) => a.entityId === id);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        before: { name: 'To edit', feeCents: 100_000 },
        after: { name: 'Edited', feeCents: 120_000, slots: 2 },
      });
    });

    it('an empty schedule clears all slots; omitting it keeps them', async () => {
      const id = await f.klass(tenant, {
        name: 'Slots',
        feeCents: 1,
        schedules: [[1, '09:00', 60]],
      });
      expect((await owner().patch(one(id), { name: 'Slots 2' })).body.schedule).toHaveLength(1);
      expect((await owner().patch(one(id), { schedule: [] })).body.schedule).toEqual([]);
    });

    it('moving a class online drops its hall; an online class cannot be given one', async () => {
      const id = await f.klass(tenant, { name: 'Goes online', feeCents: 1, hallId: hallA });
      const res = await owner().patch(one(id), { place: 'online' });
      expect(res.body).toMatchObject({ place: 'online', hallId: null, hallName: null });
      expectProblem(await owner().patch(one(id), { hallId: hallA }), 400, 'VALIDATION_FAILED');
      expect((await owner().patch(one(id), { place: 'hall', hallId: hallA })).body.hallId).toBe(
        hallA,
      );
    });

    it('assigns and clears the teacher; validates the teacher', async () => {
      const id = await f.klass(tenant, { name: 'Teacher test', feeCents: 1 });
      expect((await owner().patch(one(id), { teacherId: teacherId() })).body.teacherName).toBe(
        'teacher user',
      );
      expect((await owner().patch(one(id), { teacherId: null })).body.teacherId).toBeNull();
      expectProblem(
        await owner().patch(one(id), { teacherId: staff.gatekeeper.user.id }),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('rejects an empty body, unknown fields and unknown ids', async () => {
      expectProblem(await owner().patch(one(physics), {}), 400, 'VALIDATION_FAILED');
      expectProblem(await owner().patch(one(physics), { id: 'x' }), 400, 'VALIDATION_FAILED');
      expectProblem(
        await owner().patch(one('0193f1c2-7b1d-7c3e-9a4f-000000000999'), { name: 'x' }),
        404,
        'NOT_FOUND',
      );
    });
  });

  describe('POST /admin/classes/:id/archive', () => {
    it('hides the class from the default list, keeps enrolments readable, audits once', async () => {
      const id = await f.klass(tenant, { name: 'Soon archived', feeCents: 1 });
      const s = await f.student(tenant, { name: 'Stays Enrolled' });
      await f.enroll(tenant, s.id, id, { from: '2026-01-01' });
      expect((await owner().post(`${one(id)}/archive`)).status).toBe(204);
      expect((await owner().post(`${one(id)}/archive`)).status).toBe(204); // idempotent

      const names = ((await owner().get(LIST)).body.items as { id: string }[]).map((c) => c.id);
      expect(names).not.toContain(id);
      const listed = (await owner().get(`${LIST}?archived=true`)).body.items as {
        id: string;
        archivedAt: string;
      }[];
      expect(listed.find((c) => c.id === id)?.archivedAt).toBeTruthy();
      const detail = await owner().get(one(id));
      expect(detail.body.archivedAt).toBeTruthy();
      const students = await owner().get(`${one(id)}/students`);
      expect(col(students.body.items, 'displayName')).toEqual(['Stays Enrolled']);
      expect(
        (await f.audits(tenant, 'class.archive')).filter((a) => a.entityId === id),
      ).toHaveLength(1);
    });

    it('404s for unknown ids', async () => {
      expectProblem(
        await owner().post(`${one('0193f1c2-7b1d-7c3e-9a4f-000000000999')}/archive`),
        404,
        'NOT_FOUND',
      );
    });
  });

  describe('GET /admin/classes/:id/students — CLS-03', () => {
    it('lists current students with the effective fee, leaving out ended and archived students', async () => {
      const res = await owner().get(`${one(physics)}/students`);
      expect(res.status).toBe(200);
      const body = classStudentsResponseSchema.strict().parse(res.body);
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({
        studentId: student.id,
        displayName: 'Nimali Perera',
        phone: student.phone,
        fromMonth: '2026-01-01',
        toMonth: null,
        feeCents: 100_000,
        feeOverrideCents: 100_000,
        reason: 'Sibling discount',
      });
      expect(body.items[0]?.studentNo).toMatch(/^TT-/);
    });

    it('uses the class fee when there is no override', async () => {
      const res = await owner().get(`${one(revision)}/students`);
      expect(res.body.items[0]).toMatchObject({ feeCents: 150_000, feeOverrideCents: null });
    });
  });

  describe('class scope — STF-02', () => {
    it('a scoped teacher lists, opens and sees students of their own class only', async () => {
      const tapi = staff.teacher.api;
      const list = await tapi.get(LIST);
      expect(list.status).toBe(200);
      // The scope plus classes the teacher is assigned to (earlier tests created some).
      const ids = col(list.body.items, 'id');
      expect(ids).toContain(physics);
      for (const id of [revision, online, archived]) expect(ids).not.toContain(id);
      for (const c of list.body.items as { id: string; teacherId: string | null }[]) {
        expect(c.id === physics || c.teacherId === teacherId()).toBe(true);
      }
      expect((await tapi.get(one(physics))).status).toBe(200);
      expect((await tapi.get(`${one(physics)}/students`)).status).toBe(200);
      for (const id of [revision, online, archived]) {
        expectProblem(await tapi.get(one(id)), 404, 'NOT_FOUND');
        expectProblem(await tapi.get(`${one(id)}/students`), 404, 'NOT_FOUND');
      }
    });

    it('a teacher can ask for other classes by filter and simply gets nothing', async () => {
      const res = await staff.teacher.api.get(`${LIST}?place=online`);
      expect(res.body.items).toEqual([]);
    });
  });

  describe('permissions per role', () => {
    const roles = Object.keys({
      owner: 1,
      admin: 1,
      teacher: 1,
      cashier: 1,
      gatekeeper: 1,
    }) as StaffRole[];

    it('reading classes: owner, admin, teacher and cashier; not the gatekeeper', async () => {
      for (const role of roles) {
        const res = await staff[role].api.get(LIST);
        if (role === 'gatekeeper') expectProblem(res, 403, 'FORBIDDEN');
        else expect(res.status, role).toBe(200);
      }
      expectProblem(await staff.gatekeeper.api.get(one(physics)), 403, 'FORBIDDEN');
      expectProblem(await staff.gatekeeper.api.get(`${one(physics)}/students`), 403, 'FORBIDDEN');
    });

    it('writing classes: owner and admin only', async () => {
      for (const role of ['teacher', 'cashier', 'gatekeeper'] as const) {
        const as = staff[role].api;
        expectProblem(await as.post(LIST, payload({ name: `By ${role}` })), 403, 'FORBIDDEN');
        expectProblem(await as.patch(one(physics), { name: 'Hacked' }), 403, 'FORBIDDEN');
        expectProblem(await as.post(`${one(revision)}/archive`), 403, 'FORBIDDEN');
      }
      const res = await staff.admin.api.post(LIST, payload({ name: 'By admin' }));
      expect(res.status).toBe(201);
    });

    it('students are refused everywhere (403) and anonymous callers get 401', async () => {
      expectProblem(await studentCookieApi.get(LIST), 403, 'FORBIDDEN');
      expectProblem(await studentCookieApi.post(LIST, payload()), 403, 'FORBIDDEN');
      expectProblem(await api(t, tenant.host).get(LIST), 401, 'UNAUTHENTICATED');
      expectProblem(await api(t, tenant.host).post(LIST, payload()), 401, 'UNAUTHENTICATED');
    });
  });

  describe('cross-tenant isolation', () => {
    it("another institute's classes are invisible and cannot be read, changed or archived", async () => {
      const ids = (
        (await owner().get(`${LIST}?archived=false`)).body.items as { id: string }[]
      ).map((c) => c.id);
      expect(ids).not.toContain(foreignClass);
      expectProblem(await owner().get(one(foreignClass)), 404, 'NOT_FOUND');
      expectProblem(await owner().get(`${one(foreignClass)}/students`), 404, 'NOT_FOUND');
      expectProblem(await owner().patch(one(foreignClass), { name: 'Hacked' }), 404, 'NOT_FOUND');
      expectProblem(await owner().post(`${one(foreignClass)}/archive`), 404, 'NOT_FOUND');
      const [row] = await db
        .select()
        .from(schema.classes)
        .where(eq(schema.classes.id, foreignClass));
      expect(row).toMatchObject({ name: 'Foreign class', archivedAt: null });
    });

    it("another institute's staff session is no session here", async () => {
      const foreignStaff = await f.staff(other, ['owner']);
      const cookie = await signInStaff(t, other, foreignStaff);
      // Their own host works, ours is closed to them even with their cookie.
      expect((await api(t, other.host, cookie).get(LIST)).status).toBe(200);
      expectProblem(await api(t, tenant.host, cookie).get(LIST), 401, 'UNAUTHENTICATED');
    });
  });
});
