import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@remix/db';
import {
  dashboardResponseSchema,
  hallSchema,
  hallsResponseSchema,
  publicTimetableResponseSchema,
  timetableResponseSchema,
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
import { api, scopeTeacher, signInStudent, staffByRole, type Api } from './support/people';

/** One string column of a JSON list in a response body (supertest bodies are untyped). */
const col = (items: unknown, key: string): string[] =>
  (items as Record<string, string>[]).map((item) => item[key] ?? '');

const HALLS = '/api/v1/admin/halls';
const TIMETABLE = '/api/v1/admin/timetable';
const PUBLIC_TIMETABLE = '/api/v1/tenant/timetable';
const DASHBOARD = '/api/v1/admin/dashboard';
const GHOST = '0193f1c2-7b1d-7c3e-9a4f-000000000999';

describe('halls, timetable and dashboard (CLS-05/06) against Postgres', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  let tenant: TenantFixture;
  let other: TenantFixture;
  let staff: Record<StaffRole, { user: UserFixture; api: Api }>;
  let hallA: string;
  let hallB: string;
  let theory: string;
  let revision: string;
  let online: string;
  let archivedClass: string;
  let later: string;
  let foreignHall: string;
  let portal: Api;

  const owner = () => staff.owner.api;

  beforeAll(async () => {
    t = await createDbTestApp();
    db = ownerDb();
    f = new Factory(db);
    tenant = await f.tenant('active');
    other = await f.tenant('active');
    staff = await staffByRole(t, f, tenant);
    // A disabled staff member is not counted on the dashboard.
    await f.staff(tenant, ['cashier'], { status: 'disabled' });

    hallA = await f.hall(tenant, 'Hall A', 200);
    hallB = await f.hall(tenant, 'Hall B');
    foreignHall = await f.hall(other, 'Hall A', 50);

    // Clock: Thursday 15 October 2026, 10:00 Colombo — this week starts Monday 12 October.
    theory = await f.klass(tenant, {
      name: 'Physics Theory',
      feeCents: 250_000,
      teacherId: staff.teacher.user.id,
      hallId: hallA,
      grade: '2027 A/L',
      schedules: [
        [6, '08:00', 180],
        [3, '19:00', 120],
      ],
    });
    revision = await f.klass(tenant, {
      name: 'Revision',
      feeCents: 150_000,
      hallId: hallB,
      schedules: [
        [4, '14:00', 120],
        [4, '09:00', 60],
      ],
    });
    online = await f.klass(tenant, {
      name: 'Online Chemistry',
      feeCents: 100_000,
      place: 'online',
      schedules: [[4, '18:00', 90]],
    });
    archivedClass = await f.klass(tenant, {
      name: 'Archived Thursday',
      feeCents: 1,
      archived: true,
      hallId: hallB,
      schedules: [[4, '07:00', 60]],
    });
    later = await f.klass(tenant, {
      name: 'Starts Later',
      feeCents: 1,
      startsOn: '2026-10-20',
      schedules: [
        [1, '10:00', 60],
        [4, '10:00', 60],
      ],
    });
    await scopeTeacher(f, staff.teacher.user, [theory]);

    const s1 = await f.student(tenant, { name: 'Student One' });
    const s2 = await f.student(tenant, { name: 'Student Two' });
    await f.student(tenant, { name: 'Student Three' });
    const s4 = await f.student(tenant, { name: 'Invited Four', status: 'invited' });
    const s5 = await f.student(tenant, { name: 'Archived Five', archived: true });
    const s6 = await f.student(tenant, { name: 'October Joiner' });
    const portalStudent = await f.student(tenant, { name: 'Portal Student' });
    await f.enroll(tenant, s1.id, theory, { from: '2026-01-01' });
    await f.enroll(tenant, s1.id, revision, { from: '2026-01-01' });
    await f.enroll(tenant, s2.id, revision, { from: '2026-01-01' });
    await f.enroll(tenant, s4.id, theory, { from: '2026-01-01' });
    await f.enroll(tenant, s5.id, theory, { from: '2026-01-01' });
    await f.enroll(tenant, s6.id, theory, { from: '2026-10-01' });
    // Fixed sign-up dates: September for everyone, then two in October (the clock's month).
    await db
      .update(schema.tenantUsers)
      .set({ createdAt: new Date('2026-09-01T04:00:00Z') })
      .where(eq(schema.tenantUsers.tenantId, tenant.id));
    await db
      .update(schema.tenantUsers)
      .set({ createdAt: new Date('2026-10-02T04:00:00Z') })
      .where(inArray(schema.tenantUsers.id, [s1.id, s4.id, s5.id]));
    portal = api(t, tenant.host, await signInStudent(t, tenant, portalStudent));
  });
  afterAll(async () => {
    await t.close();
    await db.$client.end();
  });

  describe('halls — CLS-05', () => {
    it('lists halls by name in the contract shape', async () => {
      const res = await owner().get(HALLS);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(hallsResponseSchema.strict().parse(res.body).items).toEqual([
        { id: hallA, name: 'Hall A', capacity: 200 },
        { id: hallB, name: 'Hall B', capacity: null },
      ]);
    });

    it('creates, renames and audits a hall; a missing capacity is null', async () => {
      const created = await owner().post(HALLS, { name: '  Lecture Room ' });
      expect(created.status).toBe(201);
      expect(hallSchema.strict().parse(created.body)).toMatchObject({
        name: 'Lecture Room',
        capacity: null,
      });
      const id = created.body.id as string;
      const renamed = await owner().put(`${HALLS}/${id}`, { name: 'Lecture Room 2', capacity: 80 });
      expect(renamed.body).toEqual({ id, name: 'Lecture Room 2', capacity: 80 });
      const audits = (await f.audits(tenant)).filter((a) => a.entityId === id);
      expect(audits.map((a) => a.action)).toEqual(['hall.create', 'hall.update']);
      expect(audits[1]).toMatchObject({
        before: { name: 'Lecture Room', capacity: null },
        after: { name: 'Lecture Room 2', capacity: 80 },
      });
    });

    it('names are unique per institute, ignoring case (409), but free at other institutes', async () => {
      const dup = await owner().post(HALLS, { name: 'hall a' });
      expect(expectProblem(dup, 409, 'CONFLICT').errors?.[0]?.path).toBe('name');
      const second = await owner().post(HALLS, { name: 'Second Hall' });
      expectProblem(
        await owner().put(`${HALLS}/${second.body.id}`, { name: 'HALL B' }),
        409,
        'CONFLICT',
      );
      // Renaming to its own name (a capacity-only edit) is fine.
      expect(
        (await owner().put(`${HALLS}/${second.body.id}`, { name: 'Second Hall', capacity: 10 }))
          .status,
      ).toBe(200);
      // "Hall A" already exists at the other institute.
      expect(foreignHall).toBeTruthy();
    });

    it('rejects bad input with 400', async () => {
      for (const body of [
        {},
        { name: '' },
        { name: 'x'.repeat(61) },
        { name: 'Zero', capacity: 0 },
        { name: 'Huge', capacity: 5001 },
        { name: 'Frac', capacity: 1.5 },
        { name: 'Extra', colour: 'red' },
      ]) {
        expectProblem(await owner().post(HALLS, body), 400, 'VALIDATION_FAILED');
      }
    });

    it('refuses to delete a hall a class uses (409, archived classes included), deletes free ones', async () => {
      expectProblem(await owner().delete(`${HALLS}/${hallA}`), 409, 'CONFLICT');
      expectProblem(await owner().delete(`${HALLS}/${hallB}`), 409, 'CONFLICT'); // archived class too
      expect(col((await owner().get(HALLS)).body.items, 'id')).toEqual(
        expect.arrayContaining([hallA, hallB]),
      );
      const free = await owner().post(HALLS, { name: 'Free Hall' });
      expect((await owner().delete(`${HALLS}/${free.body.id}`)).status).toBe(204);
      expect((await f.audits(tenant, 'hall.delete')).some((a) => a.entityId === free.body.id)).toBe(
        true,
      );
      expectProblem(await owner().delete(`${HALLS}/${free.body.id}`), 404, 'NOT_FOUND');
    });

    it("404s for unknown ids; another institute's halls are invisible and untouchable", async () => {
      expectProblem(await owner().put(`${HALLS}/${GHOST}`, { name: 'x' }), 404, 'NOT_FOUND');
      expectProblem(
        await owner().put(`${HALLS}/${foreignHall}`, { name: 'Mine' }),
        404,
        'NOT_FOUND',
      );
      expectProblem(await owner().delete(`${HALLS}/${foreignHall}`), 404, 'NOT_FOUND');
      expectProblem(await owner().delete(`${HALLS}/not-a-uuid`), 400, 'VALIDATION_FAILED');
      expect(col((await owner().get(HALLS)).body.items, 'id')).not.toContain(foreignHall);
      const [row] = await db.select().from(schema.halls).where(eq(schema.halls.id, foreignHall));
      expect(row).toMatchObject({ name: 'Hall A', capacity: 50 });
    });

    it('permissions: everyone with classes.read lists, only owner and admin write', async () => {
      for (const role of ['owner', 'admin', 'teacher', 'cashier'] as const) {
        expect((await staff[role].api.get(HALLS)).status, role).toBe(200);
      }
      expectProblem(await staff.gatekeeper.api.get(HALLS), 403, 'FORBIDDEN');
      for (const role of ['teacher', 'cashier', 'gatekeeper'] as const) {
        const as = staff[role].api;
        expectProblem(await as.post(HALLS, { name: `By ${role}` }), 403, 'FORBIDDEN');
        expectProblem(await as.put(`${HALLS}/${hallA}`, { name: 'x' }), 403, 'FORBIDDEN');
        expectProblem(await as.delete(`${HALLS}/${hallA}`), 403, 'FORBIDDEN');
      }
      expect((await staff.admin.api.post(HALLS, { name: 'By admin' })).status).toBe(201);
      expectProblem(await portal.get(HALLS), 403, 'FORBIDDEN');
      expectProblem(await api(t, tenant.host).get(HALLS), 401, 'UNAUTHENTICATED');
    });
  });

  describe('GET /admin/timetable — CLS-06', () => {
    it('defaults to the current week (Monday 12 October, Asia/Colombo) and lists dated slots with counts', async () => {
      const res = await owner().get(TIMETABLE);
      expect(res.status).toBe(200);
      const body = timetableResponseSchema.strict().parse(res.body);
      expect(body.weekStart).toBe('2026-10-12');
      // Slots are ordered by date, then time. "Starts Later" (20 October) is not in this week;
      // the archived class never appears.
      expect(body.slots.map((s) => `${s.date} ${s.startTime} ${s.className}`)).toEqual([
        '2026-10-14 19:00 Physics Theory',
        '2026-10-15 09:00 Revision',
        '2026-10-15 14:00 Revision',
        '2026-10-15 18:00 Online Chemistry',
        '2026-10-17 08:00 Physics Theory',
      ]);
      expect(body.slots[0]).toEqual({
        classId: theory,
        className: 'Physics Theory',
        grade: '2027 A/L',
        teacherName: 'teacher user',
        hallName: 'Hall A',
        place: 'hall',
        date: '2026-10-14',
        startTime: '19:00',
        durationMinutes: 120,
        // s1, s4 (invited counts as enrolled) and the October joiner; not the archived student.
        studentCount: 3,
      });
      expect(body.slots.find((s) => s.classId === online)).toMatchObject({
        place: 'online',
        hallName: null,
        teacherName: null,
        studentCount: 0,
      });
      expect(body.slots.find((s) => s.classId === revision)?.studentCount).toBe(2);
    });

    it('a class appears only from its start date', async () => {
      const before = (await owner().get(`${TIMETABLE}?weekStart=2026-10-19`)).body.slots as {
        classId: string;
        date: string;
      }[];
      // Monday 19 October is before 20 October; Thursday 22 October is after.
      expect(before.filter((s) => s.classId === later).map((s) => s.date)).toEqual(['2026-10-22']);
    });

    it('counts enrolments per month when a week spans two months', async () => {
      const res = await owner().get(`${TIMETABLE}?weekStart=2026-09-28`);
      const theorySlots = (
        res.body.slots as { classId: string; date: string; studentCount: number }[]
      )
        .filter((s) => s.classId === theory)
        .map((s) => [s.date, s.studentCount]);
      // Wed 30 Sep: the October joiner is not enrolled yet. Sat 3 Oct: they are.
      expect(theorySlots).toEqual([
        ['2026-09-30', 2],
        ['2026-10-03', 3],
      ]);
    });

    it('rejects a week that does not start on a Monday, bad dates and unknown parameters', async () => {
      for (const q of ['weekStart=2026-10-15', 'weekStart=nope', 'weekStart=2026-13-01', 'x=1']) {
        expectProblem(await owner().get(`${TIMETABLE}?${q}`), 400, 'VALIDATION_FAILED');
      }
    });

    it('returns an empty week for a week without lessons', async () => {
      const res = await owner().get(`${TIMETABLE}?weekStart=2020-01-06`);
      expect(res.body).toEqual({ weekStart: '2020-01-06', slots: expect.any(Array) });
      // A class with a start date does not show up before it.
      expect(col(res.body.slots, 'classId')).not.toContain(later);
    });

    it('a scoped teacher sees only their own classes (STF-02)', async () => {
      const res = await staff.teacher.api.get(TIMETABLE);
      expect(res.status).toBe(200);
      expect(new Set(col(res.body.slots, 'classId'))).toEqual(new Set([theory]));
    });

    it('owner, admin, teacher and cashier read; gatekeeper and students do not; anonymous 401', async () => {
      for (const role of ['owner', 'admin', 'teacher', 'cashier'] as const) {
        expect((await staff[role].api.get(TIMETABLE)).status, role).toBe(200);
      }
      expectProblem(await staff.gatekeeper.api.get(TIMETABLE), 403, 'FORBIDDEN');
      expectProblem(await portal.get(TIMETABLE), 403, 'FORBIDDEN');
      expectProblem(await api(t, tenant.host).get(TIMETABLE), 401, 'UNAUTHENTICATED');
    });

    it("never includes another institute's classes", async () => {
      const foreign = await f.klass(other, {
        name: 'Foreign Thursday',
        feeCents: 1,
        schedules: [[4, '09:00', 60]],
      });
      const res = await owner().get(TIMETABLE);
      expect(col(res.body.slots, 'classId')).not.toContain(foreign);
      const theirs = await api(t, other.host).get(PUBLIC_TIMETABLE);
      expect(col(theirs.body.slots, 'classId')).toEqual([foreign]);
    });
  });

  describe('GET /tenant/timetable — public (CLS-06)', () => {
    it('needs no session and carries no student counts', async () => {
      const res = await api(t, tenant.host).get(PUBLIC_TIMETABLE);
      expect(res.status).toBe(200);
      const body = publicTimetableResponseSchema.strict().parse(res.body);
      expect(body.weekStart).toBe('2026-10-12');
      expect(body.slots).toHaveLength(5);
      for (const slot of res.body.slots) expect(slot).not.toHaveProperty('studentCount');
      expect(res.text).not.toMatch(/studentCount/);
    });

    it('accepts weekStart and rejects non-Mondays and unknown parameters', async () => {
      const ok = await api(t, tenant.host).get(`${PUBLIC_TIMETABLE}?weekStart=2026-10-19`);
      expect(ok.body.weekStart).toBe('2026-10-19');
      expectProblem(
        await api(t, tenant.host).get(`${PUBLIC_TIMETABLE}?weekStart=2026-10-20`),
        400,
        'VALIDATION_FAILED',
      );
      expectProblem(
        await api(t, tenant.host).get(`${PUBLIC_TIMETABLE}?week=1`),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('is closed while the institute is suspended or cancelled, open in trial', async () => {
      for (const status of ['suspended', 'cancelled'] as const) {
        const closed = await f.tenant(status);
        expectProblem(await api(t, closed.host).get(PUBLIC_TIMETABLE), 403, 'TENANT_UNAVAILABLE');
      }
      const trial = await f.tenant('trial');
      expect((await api(t, trial.host).get(PUBLIC_TIMETABLE)).status).toBe(200);
    });

    it('404s for a host that belongs to no institute', async () => {
      expectProblem(
        await api(t, 'nobody-here.remix.lk').get(PUBLIC_TIMETABLE),
        404,
        'TENANT_NOT_FOUND',
      );
    });
  });

  describe('GET /admin/dashboard', () => {
    it('returns real counts and today’s classes in start-time order', async () => {
      const res = await owner().get(DASHBOARD);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = dashboardResponseSchema.strict().parse(res.body);
      expect(body.counts).toEqual({
        // Active, not archived: one, two, three, the October joiner and the portal student.
        activeStudents: 5,
        invitedStudents: 1,
        classes: 4, // the archived class is not counted
        staff: 5, // the disabled cashier is not counted
        newStudentsThisMonth: 2, // student one and the invited student (the archived one is out)
      });
      expect(body.todaysClasses.map((s) => `${s.date} ${s.startTime} ${s.className}`)).toEqual([
        '2026-10-15 09:00 Revision',
        '2026-10-15 14:00 Revision',
        '2026-10-15 18:00 Online Chemistry',
      ]);
      expect(body.todaysClasses[0]).toMatchObject({ hallName: 'Hall B', studentCount: 2 });
    });

    it('a scoped teacher counts only their own classes and students, and no staff', async () => {
      const res = await staff.teacher.api.get(DASHBOARD);
      expect(res.status).toBe(200);
      expect(res.body.counts).toEqual({
        activeStudents: 2, // student one and the October joiner
        invitedStudents: 1,
        classes: 1,
        staff: 0,
        newStudentsThisMonth: 2,
      });
      expect(res.body.todaysClasses).toEqual([]); // their class is not on Thursdays
    });

    it('owner, admin, teacher and cashier see it; gatekeeper and students do not', async () => {
      for (const role of ['owner', 'admin', 'teacher', 'cashier'] as const) {
        expect((await staff[role].api.get(DASHBOARD)).status, role).toBe(200);
      }
      expectProblem(await staff.gatekeeper.api.get(DASHBOARD), 403, 'FORBIDDEN');
      expectProblem(await portal.get(DASHBOARD), 403, 'FORBIDDEN');
      expectProblem(await api(t, tenant.host).get(DASHBOARD), 401, 'UNAUTHENTICATED');
    });

    it('counts follow the clock: after midnight the next day’s classes appear', async () => {
      t.clock.advance(24 * 60 * 60 * 1000); // Friday 16 October
      const res = await owner().get(DASHBOARD);
      expect(res.body.todaysClasses).toEqual([]);
      t.clock.advance(24 * 60 * 60 * 1000); // Saturday 17 October
      const sat = await owner().get(DASHBOARD);
      expect(col(sat.body.todaysClasses, 'className')).toEqual(['Physics Theory']);
      t.clock.advance(-2 * 24 * 60 * 60 * 1000);
    });
  });

  it('keeps archived classes out of every view', async () => {
    const ids = [
      ...(await owner().get(TIMETABLE)).body.slots,
      ...(await api(t, tenant.host).get(PUBLIC_TIMETABLE)).body.slots,
      ...(await owner().get(DASHBOARD)).body.todaysClasses,
    ].map((s: { classId: string }) => s.classId);
    expect(ids).not.toContain(archivedClass);
  });
});
