import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@remix/db';
import {
  enrolStudentsResponseSchema,
  studentEnrollmentSchema,
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
import { api, signInStudent, staffByRole, type Api } from './support/people';

/** One string column of a JSON list in a response body (supertest bodies are untyped). */
const col = (items: unknown, key: string): string[] =>
  (items as Record<string, string>[]).map((item) => item[key] ?? '');

const CLASSES = '/api/v1/admin/classes';
const ENROLMENTS = '/api/v1/admin/enrollments';
const enrolUrl = (classId: string) => `${CLASSES}/${classId}/enrollments`;
const moveUrl = (id: string) => `${ENROLMENTS}/${id}/move`;
const GHOST = '0193f1c2-7b1d-7c3e-9a4f-000000000999';

describe('enrolments and fee overrides (CLS-04) against Postgres', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  let tenant: TenantFixture;
  let other: TenantFixture;
  let staff: Record<StaffRole, { user: UserFixture; api: Api }>;
  let physics: string;
  let chemistry: string;
  let archived: string;
  let foreignClass: string;
  let foreignStudent: UserFixture;

  const owner = () => staff.owner.api;
  const rowsOf = async (studentId: string, classId?: string) =>
    (
      await db
        .select()
        .from(schema.enrollments)
        .where(
          and(
            eq(schema.enrollments.studentId, studentId),
            classId ? eq(schema.enrollments.classId, classId) : undefined,
          ),
        )
    ).sort((a, b) => a.fromMonth.localeCompare(b.fromMonth));

  beforeAll(async () => {
    t = await createDbTestApp();
    db = ownerDb();
    f = new Factory(db);
    tenant = await f.tenant('active');
    other = await f.tenant('active');
    staff = await staffByRole(t, f, tenant);
    physics = await f.klass(tenant, { name: 'Physics', feeCents: 250_000 });
    chemistry = await f.klass(tenant, { name: 'Chemistry', feeCents: 200_000 });
    archived = await f.klass(tenant, { name: 'Old', feeCents: 1, archived: true });
    foreignClass = await f.klass(other, { name: 'Foreign', feeCents: 1 });
    foreignStudent = await f.student(other, { name: 'Foreign Fay' });
  });
  afterAll(async () => {
    await t.close();
    await db.$client.end();
  });

  describe('POST /admin/classes/:id/enrollments', () => {
    it('enrols students from a month and audits each enrolment', async () => {
      const a = await f.student(tenant, { name: 'Ann' });
      const b = await f.student(tenant, { name: 'Bob' });
      const res = await owner().post(enrolUrl(physics), {
        studentIds: [a.id, b.id],
        fromMonth: '2026-10-01',
      });
      expect(res.status).toBe(201);
      expect(enrolStudentsResponseSchema.strict().parse(res.body)).toEqual({
        enrolled: 2,
        skipped: [],
      });
      expect(await rowsOf(a.id, physics)).toMatchObject([
        { fromMonth: '2026-10-01', toMonth: null, feeOverrideCents: null, reason: null },
      ]);
      const audits = (await f.audits(tenant, 'enrollment.create')).filter(
        (r) => (r.after as { classId?: string } | null)?.classId === physics,
      );
      expect(audits.length).toBeGreaterThanOrEqual(2);
      expect(audits[0]).toMatchObject({
        actorId: staff.owner.user.id,
        entity: 'enrollment',
        after: { fromMonth: '2026-10-01' },
      });
    });

    it('skips students who are already enrolled, unknown, archived or from another institute', async () => {
      const enrolled = await f.student(tenant, { name: 'Already In' });
      const fresh = await f.student(tenant, { name: 'Fresh' });
      const gone = await f.student(tenant, { name: 'Archived', archived: true });
      await f.enroll(tenant, enrolled.id, chemistry, { from: '2026-01-01' });
      const res = await owner().post(enrolUrl(chemistry), {
        studentIds: [enrolled.id, fresh.id, gone.id, foreignStudent.id, GHOST, fresh.id],
        fromMonth: '2026-10-01',
      });
      expect(res.status).toBe(201);
      expect(res.body.enrolled).toBe(1);
      expect([...res.body.skipped].sort()).toEqual(
        [enrolled.id, gone.id, foreignStudent.id, GHOST].sort(),
      );
      expect(await rowsOf(enrolled.id, chemistry)).toHaveLength(1);
      expect(await rowsOf(foreignStudent.id)).toHaveLength(0);
      // Enrolling the same students again enrols nobody.
      const again = await owner().post(enrolUrl(chemistry), {
        studentIds: [fresh.id],
        fromMonth: '2026-10-01',
      });
      expect(again.body).toEqual({ enrolled: 0, skipped: [fresh.id] });
    });

    it('re-enrols a student whose earlier enrolment ended before the new month', async () => {
      const s = await f.student(tenant, { name: 'Came Back' });
      await f.enroll(tenant, s.id, physics, { from: '2026-01-01', to: '2026-05-01' });
      const res = await owner().post(enrolUrl(physics), {
        studentIds: [s.id],
        fromMonth: '2026-09-01',
      });
      expect(res.body.enrolled).toBe(1);
      expect(await rowsOf(s.id, physics)).toHaveLength(2);
      // But an enrolment that is still running in that month blocks a new one.
      const blocked = await owner().post(enrolUrl(physics), {
        studentIds: [s.id],
        fromMonth: '2026-12-01',
      });
      expect(blocked.body).toEqual({ enrolled: 0, skipped: [s.id] });
    });

    it('a fee override needs a reason, is stored and is audited', async () => {
      const s = await f.student(tenant, { name: 'Sibling Sam' });
      expectProblem(
        await owner().post(enrolUrl(physics), {
          studentIds: [s.id],
          fromMonth: '2026-10-01',
          feeOverrideCents: 100_000,
        }),
        400,
        'VALIDATION_FAILED',
      );
      expectProblem(
        await owner().post(enrolUrl(physics), {
          studentIds: [s.id],
          fromMonth: '2026-10-01',
          feeOverrideCents: 100_000,
          reason: '   ',
        }),
        400,
        'VALIDATION_FAILED',
      );
      expect(await rowsOf(s.id)).toHaveLength(0);

      const ok = await owner().post(enrolUrl(physics), {
        studentIds: [s.id],
        fromMonth: '2026-10-01',
        feeOverrideCents: 0,
        reason: 'Free card: teacher’s relative',
      });
      expect(ok.body.enrolled).toBe(1);
      const [row] = await rowsOf(s.id, physics);
      expect(row).toMatchObject({
        feeOverrideCents: 0,
        reason: 'Free card: teacher’s relative',
      });
      const audit = (await f.audits(tenant, 'enrollment.fee_override')).find(
        (r) => r.entityId === row?.id,
      );
      expect(audit).toMatchObject({
        before: { feeCents: 250_000 },
        after: { feeOverrideCents: 0, reason: 'Free card: teacher’s relative' },
      });
    });

    it('rejects archived or unknown classes, bad months and bad bodies', async () => {
      const s = await f.student(tenant, { name: 'Validation Val' });
      const body = { studentIds: [s.id], fromMonth: '2026-10-01' };
      expectProblem(await owner().post(enrolUrl(archived), body), 400, 'VALIDATION_FAILED');
      expectProblem(await owner().post(enrolUrl(GHOST), body), 404, 'NOT_FOUND');
      expectProblem(
        await owner().post(enrolUrl(physics), { ...body, fromMonth: '2026-10-15' }),
        400,
        'VALIDATION_FAILED',
      );
      expectProblem(
        await owner().post(enrolUrl(physics), { ...body, studentIds: [] }),
        400,
        'VALIDATION_FAILED',
      );
      expectProblem(
        await owner().post(enrolUrl(physics), { ...body, extra: true }),
        400,
        'VALIDATION_FAILED',
      );
      expect(await rowsOf(s.id)).toHaveLength(0);
    });

    it('two simultaneous enrolments of the same student create one enrolment', async () => {
      const s = await f.student(tenant, { name: 'Racer' });
      const body = { studentIds: [s.id], fromMonth: '2026-10-01' };
      const results = await Promise.all([
        owner().post(enrolUrl(chemistry), body),
        owner().post(enrolUrl(chemistry), body),
      ]);
      expect(results.map((r) => (r.body as { enrolled: number }).enrolled).sort()).toEqual([0, 1]);
      expect(await rowsOf(s.id, chemistry)).toHaveLength(1);
    });
  });

  describe('PATCH /admin/enrollments/:id', () => {
    const enrolOne = async (name: string, from = '2026-09-01') => {
      const s = await f.student(tenant, { name });
      await f.enroll(tenant, s.id, physics, { from });
      const [row] = await rowsOf(s.id, physics);
      if (!row) throw new Error('no enrolment');
      return { student: s, id: row.id };
    };

    it('sets a fee override with a reason, then removes it; both are audited', async () => {
      const { id } = await enrolOne('Override Olu');
      const set = await owner().patch(`${ENROLMENTS}/${id}`, {
        feeOverrideCents: 125_000,
        reason: 'Scholarship',
      });
      expect(set.status).toBe(200);
      expect(studentEnrollmentSchema.strict().parse(set.body)).toMatchObject({
        id,
        className: 'Physics',
        feeCents: 125_000,
        feeOverrideCents: 125_000,
        reason: 'Scholarship',
      });
      const cleared = await owner().patch(`${ENROLMENTS}/${id}`, { feeOverrideCents: null });
      expect(cleared.body).toMatchObject({ feeCents: 250_000, feeOverrideCents: null });
      const audits = (await f.audits(tenant, 'enrollment.fee_override')).filter(
        (a) => a.entityId === id,
      );
      expect(audits).toHaveLength(2);
      expect(audits[0]).toMatchObject({
        before: { feeOverrideCents: null },
        after: { feeOverrideCents: 125_000, reason: 'Scholarship' },
      });
      expect(audits[1]).toMatchObject({ before: { feeOverrideCents: 125_000 } });
    });

    it('refuses an override without a reason, and removing the reason of a live override', async () => {
      const { id } = await enrolOne('No Reason Ned');
      expectProblem(
        await owner().patch(`${ENROLMENTS}/${id}`, { feeOverrideCents: 1000 }),
        400,
        'VALIDATION_FAILED',
      );
      await owner().patch(`${ENROLMENTS}/${id}`, { feeOverrideCents: 1000, reason: 'Hardship' });
      expectProblem(
        await owner().patch(`${ENROLMENTS}/${id}`, { reason: null }),
        400,
        'VALIDATION_FAILED',
      );
      const reworded = await owner().patch(`${ENROLMENTS}/${id}`, { reason: 'Hardship, 2026' });
      expect(reworded.body.reason).toBe('Hardship, 2026');
    });

    it('ends an enrolment at the last month attended, and can re-open it', async () => {
      const { id, student } = await enrolOne('Leaver Lee');
      const ended = await owner().patch(`${ENROLMENTS}/${id}`, { toMonth: '2026-10-01' });
      expect(ended.body).toMatchObject({ fromMonth: '2026-09-01', toMonth: '2026-10-01' });
      expect((await f.audits(tenant, 'enrollment.end')).some((a) => a.entityId === id)).toBe(true);

      const list = await owner().get(`${CLASSES}/${physics}/students`);
      expect(col(list.body.items, 'studentId')).toContain(student.id);

      const reopened = await owner().patch(`${ENROLMENTS}/${id}`, { toMonth: null });
      expect(reopened.body.toMonth).toBeNull();
    });

    it('an enrolment that ended before this month no longer appears among the class students', async () => {
      const { id, student } = await enrolOne('Gone Gus');
      await owner().patch(`${ENROLMENTS}/${id}`, { toMonth: '2026-09-01' });
      const list = await owner().get(`${CLASSES}/${physics}/students`);
      expect(col(list.body.items, 'studentId')).not.toContain(student.id);
    });

    it('refuses an end month before the start and re-opening over another enrolment', async () => {
      const { id, student } = await enrolOne('Edge Eli', '2026-06-01');
      expectProblem(
        await owner().patch(`${ENROLMENTS}/${id}`, { toMonth: '2026-05-01' }),
        400,
        'VALIDATION_FAILED',
      );
      await owner().patch(`${ENROLMENTS}/${id}`, { toMonth: '2026-07-01' });
      await f.enroll(tenant, student.id, physics, { from: '2026-09-01' });
      expectProblem(await owner().patch(`${ENROLMENTS}/${id}`, { toMonth: null }), 409, 'CONFLICT');
    });

    it('rejects empty bodies, unknown fields, unknown ids and non-first-of-month dates', async () => {
      const { id } = await enrolOne('Strict Sia');
      expectProblem(await owner().patch(`${ENROLMENTS}/${id}`, {}), 400, 'VALIDATION_FAILED');
      expectProblem(
        await owner().patch(`${ENROLMENTS}/${id}`, { classId: physics }),
        400,
        'VALIDATION_FAILED',
      );
      expectProblem(
        await owner().patch(`${ENROLMENTS}/${id}`, { toMonth: '2026-10-05' }),
        400,
        'VALIDATION_FAILED',
      );
      expectProblem(
        await owner().patch(`${ENROLMENTS}/${GHOST}`, { toMonth: '2026-10-01' }),
        404,
        'NOT_FOUND',
      );
    });
  });

  describe('POST /admin/enrollments/:id/move', () => {
    it('ends the old enrolment the month before and opens the new one, keeping the override', async () => {
      const s = await f.student(tenant, { name: 'Mover Mia' });
      await f.enroll(tenant, s.id, physics, { from: '2026-01-01', feeOverrideCents: 90_000 });
      const [old] = await rowsOf(s.id, physics);
      const res = await owner().post(moveUrl(old?.id ?? ''), {
        toClassId: chemistry,
        fromMonth: '2026-11-01',
      });
      expect(res.status).toBe(200);
      const body = studentEnrollmentSchema.strict().parse(res.body);
      expect(body).toMatchObject({
        classId: chemistry,
        className: 'Chemistry',
        fromMonth: '2026-11-01',
        toMonth: null,
        feeCents: 90_000,
        feeOverrideCents: 90_000,
        reason: 'Sibling discount',
      });
      expect(body.id).not.toBe(old?.id);
      expect(await rowsOf(s.id, physics)).toMatchObject([
        { fromMonth: '2026-01-01', toMonth: '2026-10-01' },
      ]);
      const audit = (await f.audits(tenant, 'enrollment.move')).find((a) => a.entityId === body.id);
      expect(audit).toMatchObject({
        before: { enrollmentId: old?.id, classId: physics },
        after: { studentId: s.id, toClassId: chemistry, fromMonth: '2026-11-01' },
      });
    });

    it('re-points an enrolment that started in the very month of the move', async () => {
      const s = await f.student(tenant, { name: 'Same Month Sue' });
      await f.enroll(tenant, s.id, physics, { from: '2026-10-01' });
      const [old] = await rowsOf(s.id, physics);
      const res = await owner().post(moveUrl(old?.id ?? ''), {
        toClassId: chemistry,
        fromMonth: '2026-10-01',
      });
      expect(res.body).toMatchObject({ id: old?.id, classId: chemistry, fromMonth: '2026-10-01' });
      expect(await rowsOf(s.id)).toHaveLength(1);
    });

    it('carries an end month over to the new enrolment', async () => {
      const s = await f.student(tenant, { name: 'Fixed Term Fred' });
      await f.enroll(tenant, s.id, physics, { from: '2026-03-01', to: '2027-02-01' });
      const [old] = await rowsOf(s.id, physics);
      const res = await owner().post(moveUrl(old?.id ?? ''), {
        toClassId: chemistry,
        fromMonth: '2026-10-01',
      });
      expect(res.body).toMatchObject({ fromMonth: '2026-10-01', toMonth: '2027-02-01' });
    });

    it('is all or nothing: a refused move leaves the old enrolment untouched', async () => {
      const s = await f.student(tenant, { name: 'Blocked Bea' });
      await f.enroll(tenant, s.id, physics, { from: '2026-01-01' });
      await f.enroll(tenant, s.id, chemistry, { from: '2026-02-01' });
      const [old] = await rowsOf(s.id, physics);
      expectProblem(
        await owner().post(moveUrl(old?.id ?? ''), {
          toClassId: chemistry,
          fromMonth: '2026-11-01',
        }),
        409,
        'CONFLICT',
      );
      expect(await rowsOf(s.id, physics)).toMatchObject([
        { fromMonth: '2026-01-01', toMonth: null },
      ]);
      expect(await rowsOf(s.id, chemistry)).toHaveLength(1);
    });

    it('rejects the same class, archived and foreign classes, and months outside the enrolment', async () => {
      const s = await f.student(tenant, { name: 'Invalid Ivy' });
      await f.enroll(tenant, s.id, physics, { from: '2026-05-01', to: '2026-08-01' });
      const [row] = await rowsOf(s.id, physics);
      const id = row?.id ?? '';
      const move = (body: Record<string, unknown>) => owner().post(moveUrl(id), body);
      expectProblem(
        await move({ toClassId: physics, fromMonth: '2026-06-01' }),
        400,
        'VALIDATION_FAILED',
      );
      expectProblem(
        await move({ toClassId: archived, fromMonth: '2026-06-01' }),
        400,
        'VALIDATION_FAILED',
      );
      expectProblem(
        await move({ toClassId: foreignClass, fromMonth: '2026-06-01' }),
        400,
        'VALIDATION_FAILED',
      );
      expectProblem(
        await move({ toClassId: GHOST, fromMonth: '2026-06-01' }),
        400,
        'VALIDATION_FAILED',
      );
      // Before it started / after it ended.
      expectProblem(
        await move({ toClassId: chemistry, fromMonth: '2026-04-01' }),
        400,
        'VALIDATION_FAILED',
      );
      expectProblem(
        await move({ toClassId: chemistry, fromMonth: '2026-10-01' }),
        400,
        'VALIDATION_FAILED',
      );
      expectProblem(
        await move({ toClassId: chemistry, fromMonth: '2026-06-15' }),
        400,
        'VALIDATION_FAILED',
      );
      expectProblem(await move({ toClassId: chemistry }), 400, 'VALIDATION_FAILED');
      expect(await rowsOf(s.id)).toHaveLength(1);
    });

    it('404s for unknown enrolments', async () => {
      expectProblem(
        await owner().post(moveUrl(GHOST), { toClassId: chemistry, fromMonth: '2026-11-01' }),
        404,
        'NOT_FOUND',
      );
    });
  });

  describe('permissions and isolation', () => {
    it('owner and admin enrol; teacher, cashier and gatekeeper get 403 on every write', async () => {
      const s = await f.student(tenant, { name: 'Perm Pat' });
      await f.enroll(tenant, s.id, physics, { from: '2026-01-01' });
      const [row] = await rowsOf(s.id, physics);
      const id = row?.id ?? '';
      for (const role of ['teacher', 'cashier', 'gatekeeper'] as const) {
        const as = staff[role].api;
        expectProblem(
          await as.post(enrolUrl(physics), { studentIds: [s.id], fromMonth: '2026-10-01' }),
          403,
          'FORBIDDEN',
        );
        expectProblem(await as.patch(`${ENROLMENTS}/${id}`, { toMonth: null }), 403, 'FORBIDDEN');
        expectProblem(
          await as.post(moveUrl(id), { toClassId: chemistry, fromMonth: '2026-11-01' }),
          403,
          'FORBIDDEN',
        );
      }
      const admin = await staff.admin.api.patch(`${ENROLMENTS}/${id}`, {
        feeOverrideCents: 5000,
        reason: 'Admin discount',
      });
      expect(admin.status).toBe(200);
      const portal = api(
        t,
        tenant.host,
        await signInStudent(t, tenant, await f.student(tenant, { name: 'Portal Pia' })),
      );
      expectProblem(
        await portal.post(enrolUrl(physics), { studentIds: [s.id], fromMonth: '2026-10-01' }),
        403,
        'FORBIDDEN',
      );
      expectProblem(
        await api(t, tenant.host).post(enrolUrl(physics), {
          studentIds: [s.id],
          fromMonth: '2026-10-01',
        }),
        401,
        'UNAUTHENTICATED',
      );
    });

    it("another institute's enrolments and classes cannot be touched", async () => {
      const foreign = await f.student(other, { name: 'Foreign Finn' });
      await f.enroll(other, foreign.id, foreignClass, { from: '2026-01-01' });
      const [theirs] = await rowsOf(foreign.id);
      const id = theirs?.id ?? '';
      expectProblem(
        await owner().patch(`${ENROLMENTS}/${id}`, { toMonth: '2026-10-01' }),
        404,
        'NOT_FOUND',
      );
      expectProblem(
        await owner().post(moveUrl(id), { toClassId: chemistry, fromMonth: '2026-11-01' }),
        404,
        'NOT_FOUND',
      );
      expectProblem(
        await owner().post(enrolUrl(foreignClass), {
          studentIds: [foreign.id],
          fromMonth: '2026-10-01',
        }),
        404,
        'NOT_FOUND',
      );
      expect(await rowsOf(foreign.id)).toMatchObject([{ toMonth: null, classId: foreignClass }]);

      // A local enrolment cannot be moved into their class either.
      const mine = await f.student(tenant, { name: 'Local Lou' });
      await f.enroll(tenant, mine.id, physics, { from: '2026-01-01' });
      const [local] = await rowsOf(mine.id);
      expectProblem(
        await owner().post(moveUrl(local?.id ?? ''), {
          toClassId: foreignClass,
          fromMonth: '2026-11-01',
        }),
        400,
        'VALIDATION_FAILED',
      );
    });
  });
});
