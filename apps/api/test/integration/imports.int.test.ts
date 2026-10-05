import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@remix/db';
import {
  IMPORT_MAX_ROWS,
  importJobSchema,
  importPreviewResponseSchema,
  type ImportJob,
  type ImportRow,
  type StaffRole,
} from '@remix/types/api';
import { ImportRunner } from '../../src/modules/imports/import-runner';
import { PeopleHooks, type StudentInvitedEvent } from '../../src/modules/people/people-hooks';
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

const PREVIEW = '/api/v1/admin/imports/students/preview';
const COMMIT = '/api/v1/admin/imports/students/commit';
const job = (id: string) => `/api/v1/admin/imports/${id}`;

/** A distinct valid mobile per index: +9476 + 7 digits, offset so it never meets the factories'. */
const phone = (i: number) => `076${String(8_000_000 + i).padStart(7, '0')}`;

describe('student import (STU-04 / DAT-01) against Postgres', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  let tenant: TenantFixture;
  let other: TenantFixture;
  let staff: Record<StaffRole, { user: UserFixture; api: Api }>;
  let otherOwner: Api;
  let existing: UserFixture;
  let existingNo: string;
  const invited: StudentInvitedEvent[] = [];

  const owner = () => staff.owner.api;

  /** Commit, run the queued job like the worker would, and read the job back. */
  async function runImport(
    rows: ImportRow[],
    extra: { sendWelcomeSms?: boolean; enrolFrom?: string } = {},
    who: Api = owner(),
  ): Promise<ImportJob> {
    const res = await who.post(COMMIT, { rows, ...extra });
    expect(res.status).toBe(202);
    const queued = importJobSchema.strict().parse(res.body);
    await t.jobs.drain();
    const done = await who.get(job(queued.id));
    expect(done.status).toBe(200);
    return importJobSchema.strict().parse(done.body);
  }

  const studentsCount = async (tenantId: string) =>
    (await db.select().from(schema.students).where(eq(schema.students.tenantId, tenantId))).length;

  let physics: string;
  let chemistry: string;

  beforeAll(async () => {
    t = await createDbTestApp();
    db = ownerDb();
    f = new Factory(db);
    tenant = await f.tenant('active');
    other = await f.tenant('active');
    staff = await staffByRole(t, f, tenant);
    const otherStaff = await staffByRole(t, f, other, ['owner']);
    otherOwner = otherStaff.owner.api;

    physics = await f.klass(tenant, { name: 'Physics Theory', feeCents: 250_000 });
    chemistry = await f.klass(tenant, { name: 'Chemistry', feeCents: 200_000 });
    await f.klass(tenant, { name: 'Old Class', feeCents: 1, archived: true });
    await f.klass(other, { name: 'Foreign Class', feeCents: 1 });

    existing = await f.student(tenant, { name: 'Existing Student', phone: '+94711234567' });
    const [row] = await db
      .select({ no: schema.students.studentNo })
      .from(schema.students)
      .where(eq(schema.students.userId, existing.id));
    existingNo = row?.no ?? '';

    t.app.get(PeopleHooks).registerStudentInvited((event) => {
      invited.push(event);
    });
  });
  afterAll(async () => {
    await t.close();
    await db.$client.end();
  });

  describe('POST /admin/imports/students/preview — dry run', () => {
    const rows: ImportRow[] = [
      { displayName: 'Preview One', phone: '0770000001', classes: 'physics theory;Chemistry' },
      { displayName: 'Preview Bad', phone: 'not a phone' },
      { displayName: 'Preview Dup', phone: '0711234567' },
      { displayName: 'Preview Again', phone: '+94770000001' },
      { displayName: 'Preview Minor', phone: '0770000002', under18: 'yes' },
      { displayName: 'Preview Class', phone: '0770000003', classes: 'Old Class; Foreign Class' },
    ];

    it('reports every row in the contract shape and writes nothing', async () => {
      const before = await studentsCount(tenant.id);
      const jobsBefore = await db.select().from(schema.importJobs);
      const res = await owner().post(PREVIEW, { rows });
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = importPreviewResponseSchema.strict().parse(res.body);
      expect(body.summary).toEqual({ total: 6, ok: 1, errors: 3, duplicates: 2 });
      expect(body.rows.map((r) => r.status)).toEqual([
        'ok',
        'error',
        'duplicate',
        'duplicate',
        'error',
        'error',
      ]);
      expect(body.rows[2]?.duplicateOf).toEqual({ studentNo: existingNo, rowNo: null });
      expect(body.rows[3]?.duplicateOf).toEqual({ studentNo: null, rowNo: 1 });
      expect(body.rows[4]?.errors).toEqual([
        { field: 'consentGivenBy', message: 'Parental consent is required for students under 18' },
      ]);
      expect(body.rows[5]?.errors.map((e) => e.message)).toEqual([
        '"Old Class" is archived',
        'No class named "Foreign Class"',
      ]);
      expect(await studentsCount(tenant.id)).toBe(before);
      expect(await db.select().from(schema.importJobs)).toHaveLength(jobsBefore.length);
    });

    it('rejects unknown fields, an empty file and more than 5,000 rows', async () => {
      expectProblem(
        await owner().post(PREVIEW, { rows: [{ displayName: 'x', nope: '1' }] }),
        400,
        'VALIDATION_FAILED',
      );
      expectProblem(await owner().post(PREVIEW, { rows: [] }), 400, 'VALIDATION_FAILED');
      const tooMany = Array.from({ length: IMPORT_MAX_ROWS + 1 }, () => ({ displayName: 'x' }));
      expectProblem(await owner().post(PREVIEW, { rows: tooMany }), 400, 'VALIDATION_FAILED');
    });

    it('accepts a full 5,000-row body (far above the 100 kB default limit)', async () => {
      const big = Array.from({ length: IMPORT_MAX_ROWS }, (_, i) => ({
        displayName: `Student number ${i}`,
        phone: phone(10_000 + i),
        school: 'A school with a rather long name, '.repeat(3),
      }));
      const started = performance.now();
      const res = await owner().post(PREVIEW, { rows: big });
      expect(res.status).toBe(200);
      expect(res.body.summary).toEqual({ total: 5000, ok: 5000, errors: 0, duplicates: 0 });
      expect(performance.now() - started).toBeLessThan(10_000);
    });

    it('keeps the 100 kB limit on every other route', async () => {
      const res = await owner().post('/api/v1/admin/students', {
        displayName: 'x'.repeat(200_000),
      });
      expect(res.status).toBe(413);
    });
  });

  describe('POST /admin/imports/students/commit — queued job', () => {
    it('answers 202 with a queued job, then the worker writes students, guardians, consent and enrolments in one go', async () => {
      invited.length = 0;
      const audits = (await f.audits(tenant, 'import.students')).length;
      const res = await owner().post(COMMIT, {
        rows: [
          {
            displayName: 'Imported Nimali',
            phone: '0771000001',
            school: 'Ananda College',
            alYear: '2027',
            medium: 'Sinhala',
            classes: 'Physics Theory; chemistry',
          },
          {
            displayName: 'Imported Minor',
            phone: '0771000002',
            under18: 'yes',
            consentGivenBy: 'Sunethra Perera',
            guardianName: 'Sunethra Perera',
            guardianRelation: 'mother',
            guardianPhone: '0712345678',
            studentNo: 'KEEP-7',
            classes: 'Physics Theory',
          },
          { displayName: 'Bad Row', phone: 'x' },
          { displayName: 'Dup Row', phone: '0711234567' },
          { displayName: 'Imported Third', phone: '0771000003' },
        ],
        enrolFrom: '2026-10-01',
        sendWelcomeSms: true,
      });
      expect(res.status).toBe(202);
      const queued = importJobSchema.strict().parse(res.body);
      expect(queued).toMatchObject({ status: 'queued', summary: null, created: null, rows: null });
      expect(t.jobs.of('imports').map((j) => j.status)).toContain('pending');

      await t.jobs.drain();
      const polled = await owner().get(job(queued.id));
      expect(polled.status).toBe(200);
      expect(polled.headers['cache-control']).toBe('no-store');
      const done = importJobSchema.strict().parse(polled.body);
      expect(done).toMatchObject({
        id: queued.id,
        status: 'done',
        summary: { total: 5, ok: 3, errors: 1, duplicates: 1 },
        created: 3,
        enrolled: 3,
      });
      expect(done.finishedAt).not.toBeNull();
      expect(done.rows?.map((r) => r.status)).toEqual(['ok', 'ok', 'error', 'duplicate', 'ok']);

      const people = await db
        .select({
          name: schema.tenantUsers.displayName,
          status: schema.tenantUsers.status,
          password: schema.tenantUsers.passwordHash,
          no: schema.students.studentNo,
          under18: schema.students.under18,
          consent: schema.students.consentGivenBy,
          method: schema.students.consentMethod,
          school: schema.students.school,
          year: schema.students.alYear,
          medium: schema.students.medium,
        })
        .from(schema.students)
        .innerJoin(schema.tenantUsers, eq(schema.tenantUsers.id, schema.students.userId))
        .where(eq(schema.students.tenantId, tenant.id));
      const byName = (name: string) => people.find((p) => p.name === name);
      expect(byName('Imported Nimali')).toMatchObject({
        status: 'invited',
        password: null,
        school: 'Ananda College',
        year: 2027,
        medium: 'sinhala',
        under18: false,
        consent: null,
      });
      expect(byName('Imported Minor')).toMatchObject({
        no: 'KEEP-7',
        under18: true,
        consent: 'Sunethra Perera',
        method: 'paper_form',
      });
      // Generated numbers come from the counter, in file order, and do not touch KEEP-7.
      const generated = ['Imported Nimali', 'Imported Third'].map((n) => byName(n)?.no);
      expect(generated.every((n) => /^[A-Z]{2,4}-26-\d{4,}$/.test(n ?? ''))).toBe(true);
      expect(new Set(generated).size).toBe(2);

      const minor = await db
        .select()
        .from(schema.tenantUsers)
        .where(eq(schema.tenantUsers.displayName, 'Imported Minor'));
      const guardian = await db
        .select()
        .from(schema.guardians)
        .where(eq(schema.guardians.studentId, minor[0]?.id ?? ''));
      expect(guardian).toMatchObject([
        { name: 'Sunethra Perera', relation: 'mother', phone: '+94712345678', smsOptIn: true },
      ]);
      const nimali = await db
        .select()
        .from(schema.tenantUsers)
        .where(eq(schema.tenantUsers.displayName, 'Imported Nimali'));
      const enrolled = await db
        .select()
        .from(schema.enrollments)
        .where(eq(schema.enrollments.studentId, nimali[0]?.id ?? ''));
      expect(enrolled.map((e) => [e.classId, e.fromMonth]).sort()).toEqual(
        [
          [physics, '2026-10-01'],
          [chemistry, '2026-10-01'],
        ].sort(),
      );

      // One audit event for the whole import, with counts and no personal data.
      const events = await f.audits(tenant, 'import.students');
      expect(events).toHaveLength(audits + 1);
      expect(events.at(-1)).toMatchObject({
        entity: 'import',
        entityId: queued.id,
        actorKind: 'staff',
        actorId: staff.owner.user.id,
        after: { total: 5, created: 3, enrolled: 3, errors: 1, duplicates: 1 },
      });
      expect(JSON.stringify(events.at(-1)?.after)).not.toContain('0771000001');

      // The personal data of the input is dropped once the job is finished.
      const [stored] = await db
        .select({ input: schema.importJobs.input })
        .from(schema.importJobs)
        .where(eq(schema.importJobs.id, queued.id));
      expect(stored?.input).toBeNull();

      // sendWelcomeSms: the first-password hook ran for each created student only.
      expect(invited.map((e) => e.displayName).sort()).toEqual([
        'Imported Minor',
        'Imported Nimali',
        'Imported Third',
      ]);
    });

    it('does not send welcome SMS unless asked', async () => {
      invited.length = 0;
      const done = await runImport([{ displayName: 'Quiet One', phone: '0771000010' }]);
      expect(done.created).toBe(1);
      expect(invited).toEqual([]);
    });

    it('defaults the enrolment month to the current month (Asia/Colombo)', async () => {
      await runImport([
        { displayName: 'Month Default', phone: '0771000011', classes: 'Chemistry' },
      ]);
      const [row] = await db
        .select({ from: schema.enrollments.fromMonth })
        .from(schema.enrollments)
        .innerJoin(schema.tenantUsers, eq(schema.tenantUsers.id, schema.enrollments.studentId))
        .where(eq(schema.tenantUsers.displayName, 'Month Default'));
      expect(row?.from).toBe('2026-10-01');
    });

    it('skips any number a sheet brought itself when allocating, so the commit cannot collide', async () => {
      const [counter] = await db
        .select({ value: schema.tenantCounters.value })
        .from(schema.tenantCounters)
        .where(eq(schema.tenantCounters.tenantId, tenant.id));
      // The next number the counter would hand out.
      const taken = `${tenant.prefix}-26-${String((counter?.value ?? 0) + 1).padStart(4, '0')}`;
      const done = await runImport([
        { displayName: 'Brings Number', phone: '0771000020', studentNo: taken },
        { displayName: 'Gets Number', phone: '0771000021' },
      ]);
      expect(done.created).toBe(2);
      const numbers = await db
        .select({ no: schema.students.studentNo, name: schema.tenantUsers.displayName })
        .from(schema.students)
        .innerJoin(schema.tenantUsers, eq(schema.tenantUsers.id, schema.students.userId))
        .where(eq(schema.students.tenantId, tenant.id));
      expect(numbers.find((n) => n.name === 'Brings Number')?.no).toBe(taken);
      const gets = numbers.find((n) => n.name === 'Gets Number')?.no;
      expect(gets).not.toBe(taken);
      expect(gets).toMatch(/^[A-Z]{2,4}-26-\d{4,}$/);
    });

    it('reserves supplied numbers for a later Add student, even without generated rows', async () => {
      const [counter] = await db
        .select({ value: schema.tenantCounters.value })
        .from(schema.tenantCounters)
        .where(eq(schema.tenantCounters.tenantId, tenant.id));
      const next = (counter?.value ?? 0) + 1;
      const taken = `${tenant.prefix}-26-${String(next).padStart(4, '0')}`;
      const done = await runImport([
        { displayName: 'Reserved Number', phone: '0771000022', studentNo: taken },
      ]);
      expect(done).toMatchObject({ status: 'done', created: 1 });
      const added = await owner().post('/api/v1/admin/students', {
        displayName: 'Added After Import',
        phone: '0771000023',
        under18: false,
      });
      expect(added.status).toBe(201);
      expect(added.body.studentNo).toBe(`${tenant.prefix}-26-${String(next + 1).padStart(4, '0')}`);
    });

    it('re-validates in the worker: a phone taken after the preview becomes a duplicate', async () => {
      const rows = [{ displayName: 'Race Student', phone: '0771000030' }];
      const preview = await owner().post(PREVIEW, { rows });
      expect(preview.body.rows[0].status).toBe('ok');
      const res = await owner().post(COMMIT, { rows });
      expect(res.status).toBe(202);
      await f.student(tenant, { name: 'Got There First', phone: '+94771000030' });
      await t.jobs.drain();
      const done = importJobSchema.parse(
        (await owner().get(job(importJobSchema.parse(res.body).id))).body,
      );
      expect(done).toMatchObject({ status: 'done', created: 0 });
      expect(done.rows?.[0]).toMatchObject({ status: 'duplicate' });
    });

    it('is idempotent: running the same job again, or queueing its id again, creates nothing', async () => {
      const rows = [
        { displayName: 'Idem One', phone: '0771000040', classes: 'Chemistry' },
        { displayName: 'Idem Two', phone: '0771000041' },
      ];
      const done = await runImport(rows);
      expect(done.created).toBe(2);
      const before = await studentsCount(tenant.id);
      const audits = (await f.audits(tenant, 'import.students')).length;

      const runner = t.app.get(ImportRunner);
      for (let i = 0; i < 3; i++) {
        await expect(runner.run({ tenantId: tenant.id, importId: done.id })).resolves.toBe(
          'skipped',
        );
      }
      await t.jobs.add('imports', { tenantId: tenant.id, importId: done.id });
      await t.jobs.drain();

      expect(await studentsCount(tenant.id)).toBe(before);
      expect(await f.audits(tenant, 'import.students')).toHaveLength(audits);
      const again = importJobSchema.parse((await owner().get(job(done.id))).body);
      expect(again).toEqual(done);

      // A second upload of the same file is a new job and finds everything already imported.
      const second = await runImport(rows);
      expect(second).toMatchObject({ created: 0, summary: { duplicates: 2, ok: 0 } });
      expect(await studentsCount(tenant.id)).toBe(before);
    });

    it('marks the job failed (and drops its input) when it can never succeed', async () => {
      const [broken] = await db
        .insert(schema.importJobs)
        .values({
          tenantId: tenant.id,
          createdBy: staff.owner.user.id,
          options: {},
          input: { not: 'an array' },
        })
        .returning({ id: schema.importJobs.id });
      await t.jobs.add('imports', { tenantId: tenant.id, importId: broken?.id ?? '' });
      await t.jobs.drain();
      const res = await owner().get(job(broken?.id ?? ''));
      expect(importJobSchema.parse(res.body)).toMatchObject({
        status: 'failed',
        summary: null,
        created: null,
        rows: null,
      });
      const [stored] = await db
        .select({ input: schema.importJobs.input })
        .from(schema.importJobs)
        .where(eq(schema.importJobs.id, broken?.id ?? ''));
      expect(stored?.input).toBeNull();
    });

    it('treats formula-looking cells as plain text and stores them verbatim', async () => {
      const name = '=HYPERLINK("http://evil.example","click")';
      const done = await runImport([
        { displayName: name, phone: '0771000050', school: '@SUM(1+1)' },
      ]);
      expect(done).toMatchObject({ created: 1 });
      const [row] = await db
        .select({ name: schema.tenantUsers.displayName, school: schema.students.school })
        .from(schema.students)
        .innerJoin(schema.tenantUsers, eq(schema.tenantUsers.id, schema.students.userId))
        .where(
          and(eq(schema.students.tenantId, tenant.id), eq(schema.students.school, '@SUM(1+1)')),
        );
      expect(row).toEqual({ name, school: '@SUM(1+1)' });
    });

    it('fails fast with 503 and leaves no orphan job when the queue is down', async () => {
      const before = (await db.select().from(schema.importJobs)).length;
      const original = t.jobs.add.bind(t.jobs);
      const { JobQueueUnavailableError } = await import('../../src/jobs/job-producer');
      t.jobs.add = () => Promise.reject(new JobQueueUnavailableError());
      try {
        const res = await owner().post(COMMIT, {
          rows: [{ displayName: 'Q', phone: '0771000060' }],
        });
        expect(res.status).toBe(503);
      } finally {
        t.jobs.add = original;
      }
      expect(await db.select().from(schema.importJobs)).toHaveLength(before);
    });
  });

  describe('500-row import', () => {
    it('queues, validates and writes 500 students, guardians and enrolments in well under a few seconds', async () => {
      const rows: ImportRow[] = Array.from({ length: 500 }, (_, i) => ({
        displayName: `Bulk Student ${String(i).padStart(3, '0')}`,
        phone: phone(i),
        school: 'Bulk College',
        alYear: '2027',
        medium: ['sinhala', 'tamil', 'english'][i % 3] ?? 'english',
        under18: i % 5 === 0 ? 'yes' : 'no',
        consentGivenBy: i % 5 === 0 ? 'Parent' : '',
        guardianName: `Guardian ${i}`,
        guardianRelation: 'mother',
        guardianPhone: phone(100_000 + i),
        classes: i % 2 === 0 ? 'Physics Theory; Chemistry' : 'Chemistry',
      }));
      const before = await studentsCount(tenant.id);

      const preview = await owner().post(PREVIEW, { rows });
      expect(preview.status).toBe(200);
      expect(preview.body.summary).toEqual({ total: 500, ok: 500, errors: 0, duplicates: 0 });

      const started = performance.now();
      const res = await owner().post(COMMIT, { rows });
      expect(res.status).toBe(202);
      await t.jobs.drain();
      const elapsed = performance.now() - started;
      const done = importJobSchema.parse(
        (await owner().get(job(importJobSchema.parse(res.body).id))).body,
      );
      // eslint-disable-next-line no-console
      console.info(`500-row import: commit + job + poll = ${Math.round(elapsed)} ms`);

      expect(done).toMatchObject({
        status: 'done',
        created: 500,
        enrolled: 750,
        summary: { total: 500, ok: 500, errors: 0, duplicates: 0 },
      });
      expect(await studentsCount(tenant.id)).toBe(before + 500);
      const numbers = (
        await db
          .select({ no: schema.students.studentNo })
          .from(schema.students)
          .where(eq(schema.students.tenantId, tenant.id))
      ).map((r) => r.no);
      expect(new Set(numbers).size).toBe(numbers.length);
      expect(elapsed).toBeLessThan(4000);
    });
  });

  describe('permissions and tenancy', () => {
    const rows = [{ displayName: 'Perm Check', phone: '0771000070' }];

    it('owner and admin may import; teacher, cashier and gatekeeper get 403 on all three routes', async () => {
      for (const role of ['owner', 'admin'] as const) {
        expect((await staff[role].api.post(PREVIEW, { rows })).status).toBe(200);
      }
      const admin = await staff.admin.api.post(COMMIT, { rows: [] });
      expectProblem(admin, 400, 'VALIDATION_FAILED');
      const adminJob = await runImport(
        [{ displayName: 'Admin Imported', phone: '0771000071' }],
        {},
        staff.admin.api,
      );
      expect(adminJob.created).toBe(1);

      for (const role of ['teacher', 'cashier', 'gatekeeper'] as const) {
        const who = staff[role].api;
        expectProblem(await who.post(PREVIEW, { rows }), 403, 'FORBIDDEN');
        expectProblem(await who.post(COMMIT, { rows }), 403, 'FORBIDDEN');
        expectProblem(await who.get(job(adminJob.id)), 403, 'FORBIDDEN');
      }
    });

    it('refuses students and anonymous callers', async () => {
      const cookie = await signInStudent(t, tenant, existing);
      const asStudent = api(t, tenant.host, cookie);
      expectProblem(await asStudent.post(PREVIEW, { rows }), 403, 'FORBIDDEN');
      expectProblem(await asStudent.post(COMMIT, { rows }), 403, 'FORBIDDEN');
      const anon = api(t, tenant.host);
      expectProblem(await anon.post(PREVIEW, { rows }), 401, 'UNAUTHENTICATED');
      expectProblem(await anon.get(job(existing.id)), 401, 'UNAUTHENTICATED');
    });

    it('an import job is visible to its own tenant only', async () => {
      const mine = await runImport([{ displayName: 'Tenant Bound', phone: '0771000080' }]);
      expect((await owner().get(job(mine.id))).status).toBe(200);
      expectProblem(await otherOwner.get(job(mine.id)), 404, 'NOT_FOUND');
      expectProblem(
        await otherOwner.get(job('00000000-0000-4000-8000-000000000000')),
        404,
        'NOT_FOUND',
      );
    });

    it('imports into one tenant never touch another and never match its classes or phones', async () => {
      const otherBefore = await studentsCount(other.id);
      const res = await otherOwner.post(PREVIEW, {
        rows: [
          // Same phone as a student of the first tenant: free here.
          { displayName: 'Other Tenant', phone: '0711234567', classes: 'Foreign Class' },
          // A class of the first tenant: unknown here.
          { displayName: 'Other Tenant 2', phone: '0771000090', classes: 'Physics Theory' },
        ],
      });
      expect(res.status).toBe(200);
      expect(importPreviewResponseSchema.parse(res.body).rows.map((r) => r.status)).toEqual([
        'ok',
        'error',
      ]);
      const done = await runImport(
        [{ displayName: 'Other Tenant', phone: '0711234567', classes: 'Foreign Class' }],
        {},
        otherOwner,
      );
      expect(done).toMatchObject({ created: 1, enrolled: 1 });
      expect(await studentsCount(other.id)).toBe(otherBefore + 1);
      // The first tenant's student with that phone is untouched.
      const [mine] = await db
        .select({ name: schema.tenantUsers.displayName })
        .from(schema.tenantUsers)
        .where(eq(schema.tenantUsers.id, existing.id));
      expect(mine?.name).toBe('Existing Student');
    });
  });
});
