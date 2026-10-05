import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@remix/db';
import {
  listStudentsResponseSchema,
  studentProfileSchema,
  type StaffRole,
  type StudentProfile,
} from '@remix/types/api';
import { PeopleHooks, type StudentInvitedEvent } from '../../src/modules/people/people-hooks';
import { expectProblem } from '../fixtures/problem';
import { lastCode, smsTo } from './support/auth-helpers';
import {
  createDbTestApp,
  Factory,
  ownerDb,
  uniquePhone,
  type DbTestApp,
  type TenantFixture,
  type UserFixture,
} from './support/db-app';
import {
  api,
  bulkStudents,
  scopeTeacher,
  signInStaff,
  signInStudent,
  staffByRole,
  type Api,
} from './support/people';

const LIST = '/api/v1/admin/students';
const BULK = '/api/v1/admin/students/bulk';
const one = (id: string) => `${LIST}/${id}`;

describe('admin students (STU-01/02/03/05/07, PAR-01/03) against Postgres', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  let tenant: TenantFixture;
  let other: TenantFixture;
  let staff: Record<StaffRole, { user: UserFixture; api: Api }>;
  let classA: string;
  let classB: string;
  let classArchived: string;
  let foreignClass: string;
  const s = {} as Record<'nimali' | 'kasun' | 'hiruni' | 'both' | 'none' | 'old', UserFixture>;
  const invited: StudentInvitedEvent[] = [];

  const owner = () => staff.owner.api;

  beforeAll(async () => {
    t = await createDbTestApp();
    db = ownerDb();
    f = new Factory(db);
    tenant = await f.tenant('active');
    other = await f.tenant('active');
    staff = await staffByRole(t, f, tenant);

    classA = await f.klass(tenant, { name: 'Physics Theory', feeCents: 250_000 });
    classB = await f.klass(tenant, { name: 'Chemistry', feeCents: 200_000 });
    classArchived = await f.klass(tenant, { name: 'Old class', feeCents: 1, archived: true });
    foreignClass = await f.klass(other, { name: 'Foreign class', feeCents: 1 });
    await scopeTeacher(f, staff.teacher.user, [classA]);

    s.nimali = await f.student(tenant, { name: 'Nimali Perera', phone: '+94711234567' });
    s.kasun = await f.student(tenant, { name: 'Kasun Silva', phone: '+94722345678' });
    s.hiruni = await f.student(tenant, { name: 'Hiruni Fernando', phone: '+94733456789' });
    s.both = await f.student(tenant, { name: 'Both Classes' });
    s.none = await f.student(tenant, { name: 'No Classes' });
    s.old = await f.student(tenant, { name: 'Archived Ann', archived: true });
    await f.enroll(tenant, s.nimali.id, classA, { from: '2026-01-01' });
    await f.enroll(tenant, s.kasun.id, classA, { from: '2026-09-01', feeOverrideCents: 100_000 });
    await f.enroll(tenant, s.hiruni.id, classB, { from: '2026-01-01' });
    await f.enroll(tenant, s.both.id, classA, { from: '2026-01-01' });
    await f.enroll(tenant, s.both.id, classB, { from: '2026-01-01' });
    // Ended last month: not a current class.
    await f.enroll(tenant, s.none.id, classA, { from: '2026-01-01', to: '2026-09-01' });
    await db.insert(schema.guardians).values({
      tenantId: tenant.id,
      studentId: s.nimali.id,
      name: 'Sunethra Perera',
      relation: 'mother',
      phone: '+94770000111',
    });
    await db
      .update(schema.tenantUsers)
      .set({ status: 'invited', passwordHash: null })
      .where(eq(schema.tenantUsers.id, s.none.id));
    await db.insert(schema.devices).values(
      ['Chrome on Android', 'Safari on iPhone'].map((label, i) => ({
        tenantId: tenant.id,
        userId: s.nimali.id,
        tokenHash: `${i}`.repeat(64),
        label,
      })),
    );
    await db.insert(schema.devices).values({
      tenantId: tenant.id,
      userId: s.nimali.id,
      tokenHash: 'f'.repeat(64),
      label: 'Old laptop',
      signedOutAt: new Date(),
    });

    t.app.get(PeopleHooks).registerStudentInvited((event) => {
      invited.push(event);
    });
  });
  afterAll(async () => {
    await t.close();
    await db.$client.end();
  });

  describe('GET /admin/students — STU-01', () => {
    it('lists non-archived students with class names and active devices, in the contract shape', async () => {
      const res = await owner().get(LIST);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = listStudentsResponseSchema.strict().parse(res.body);
      expect(body).toMatchObject({ page: 1, pageSize: 25, total: 5 });
      const nimali = body.items.find((i) => i.id === s.nimali.id);
      expect(nimali).toMatchObject({
        displayName: 'Nimali Perera',
        phone: '+94711234567',
        status: 'active',
        classNames: ['Physics Theory'],
        activeDevices: 2,
      });
      expect(body.items.find((i) => i.id === s.none.id)).toMatchObject({
        status: 'invited',
        classNames: [],
      });
      expect(body.items.map((i) => i.id)).not.toContain(s.old.id);
    });

    it('searches name, student number and phone (national or international form)', async () => {
      const names = async (q: string) =>
        (
          (await owner().get(`${LIST}?q=${encodeURIComponent(q)}`)).body.items as {
            displayName: string;
          }[]
        ).map((i) => i.displayName);
      expect(await names('nimali')).toEqual(['Nimali Perera']);
      expect(await names('0711234567')).toEqual(['Nimali Perera']);
      expect(await names('+94722345678')).toEqual(['Kasun Silva']);
      expect(await names('%')).toEqual([]); // LIKE wildcards are escaped
      const no = (await owner().get(one(s.hiruni.id))).body.studentNo as string;
      expect(await names(no)).toEqual(['Hiruni Fernando']);
    });

    it('filters by class, status, devices and joined date; sorts', async () => {
      const ids = async (query: string) =>
        ((await owner().get(`${LIST}?${query}`)).body.items as { id: string }[]).map((i) => i.id);
      expect((await ids(`classId=${classA}`)).sort()).toEqual(
        [s.nimali, s.kasun, s.both].map((u) => u.id).sort(),
      );
      expect(await ids('status=invited')).toEqual([s.none.id]);
      expect(await ids('status=archived')).toEqual([s.old.id]);
      expect(await ids('minDevices=2')).toEqual([s.nimali.id]);
      expect(await ids('joinedFrom=2999-01-01')).toEqual([]);
      expect((await ids('joinedFrom=2000-01-01&joinedTo=2999-01-01')).length).toBe(5);
      const byName = (await owner().get(`${LIST}?sort=name`)).body.items as {
        displayName: string;
      }[];
      expect(byName.map((i) => i.displayName)).toEqual(
        [...byName.map((i) => i.displayName)].sort((a, b) => a.localeCompare(b)),
      );
    });

    it('paginates with a stable order and reports the total', async () => {
      const extra = await bulkStudents(f, tenant, 27, 'PG');
      const page1 = (await owner().get(`${LIST}?q=PG&pageSize=25&page=1&sort=studentNo`)).body;
      const page2 = (await owner().get(`${LIST}?q=PG&pageSize=25&page=2&sort=studentNo`)).body;
      expect(page1).toMatchObject({ total: 27, page: 1, pageSize: 25 });
      expect(page1.items).toHaveLength(25);
      expect(page2.items).toHaveLength(2);
      const seen = [...page1.items, ...page2.items].map((i: { id: string }) => i.id);
      expect(new Set(seen).size).toBe(27);
      expect(seen.sort()).toEqual([...extra].sort());
      await db.delete(schema.students).where(inArray(schema.students.userId, extra));
      await db.delete(schema.tenantUsers).where(inArray(schema.tenantUsers.id, extra));
    });

    it('rejects unknown query parameters and bad page sizes with 400', async () => {
      expectProblem(await owner().get(`${LIST}?pageSize=7`), 400, 'VALIDATION_FAILED');
      expectProblem(await owner().get(`${LIST}?nope=1`), 400, 'VALIDATION_FAILED');
    });
  });

  describe('class scope — STF-02', () => {
    it('a scoped teacher lists only students of their classes, and only those class names', async () => {
      const res = await staff.teacher.api.get(LIST);
      expect(res.status).toBe(200);
      const items = res.body.items as { id: string; classNames: string[] }[];
      expect(items.map((i) => i.id).sort()).toEqual(
        [s.nimali, s.kasun, s.both].map((u) => u.id).sort(),
      );
      // "Both Classes" also takes Chemistry, which the teacher must not learn about.
      expect(items.find((i) => i.id === s.both.id)?.classNames).toEqual(['Physics Theory']);
    });

    it('asking for another class returns nothing, not an error', async () => {
      const res = await staff.teacher.api.get(`${LIST}?classId=${classB}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    });

    it('opens a student of their class (without devices) and 404s for any other student', async () => {
      const inScope = await staff.teacher.api.get(one(s.both.id));
      expect(inScope.status).toBe(200);
      const profile = studentProfileSchema.strict().parse(inScope.body);
      expect(profile.enrollments.map((e) => e.className)).toEqual(['Physics Theory']);
      expect(profile.devices).toEqual([]);

      expectProblem(await staff.teacher.api.get(one(s.hiruni.id)), 404, 'NOT_FOUND');
      expectProblem(await staff.teacher.api.get(one(s.none.id)), 404, 'NOT_FOUND');
    });

    it('a teacher who also owns the institute is not scoped', async () => {
      const both = await f.staff(tenant, ['owner', 'teacher']);
      const cookie = await signInStaff(t, tenant, both);
      expect((await api(t, tenant.host, cookie).get(LIST)).body.total).toBe(5);
    });

    it('a teacher without classes (and none taught) sees nobody', async () => {
      const fresh = await f.staff(tenant, ['teacher']);
      const cookie = await signInStaff(t, tenant, fresh);
      expect((await api(t, tenant.host, cookie).get(LIST)).body.items).toEqual([]);
    });

    it('classes a teacher is assigned to count even without an explicit scope', async () => {
      const assigned = await f.staff(tenant, ['teacher']);
      const taught = await f.klass(tenant, { name: 'Taught', feeCents: 1, teacherId: assigned.id });
      await f.enroll(tenant, s.hiruni.id, taught, { from: '2026-01-01' });
      const cookie = await signInStaff(t, tenant, assigned);
      const items = (await api(t, tenant.host, cookie).get(LIST)).body.items as { id: string }[];
      expect(items.map((i) => i.id)).toEqual([s.hiruni.id]);
    });
  });

  describe('GET /admin/students/:id — STU-05', () => {
    it('returns the full profile with null figures for later phases', async () => {
      const res = await owner().get(one(s.nimali.id));
      expect(res.status).toBe(200);
      const profile = studentProfileSchema.strict().parse(res.body);
      expect(profile).toMatchObject({
        displayName: 'Nimali Perera',
        under18: false,
        consent: null,
        overview: {
          owesCents: null,
          paidThisYearCents: null,
          attendancePercent: null,
          lessonsWatched: null,
        },
        archivedAt: null,
      });
      expect(profile.guardians).toEqual([
        expect.objectContaining({ name: 'Sunethra Perera', relation: 'mother', smsOptIn: true }),
      ]);
      // Only live devices; the signed-out laptop is not listed.
      expect(profile.devices.map((d) => d.label).sort()).toEqual([
        'Chrome on Android',
        'Safari on iPhone',
      ]);
      expect(profile.enrollments[0]).toMatchObject({
        className: 'Physics Theory',
        feeCents: 250_000,
        feeOverrideCents: null,
      });
    });

    it('shows the effective fee when a fee override applies', async () => {
      const profile = (await owner().get(one(s.kasun.id))).body as StudentProfile;
      expect(profile.enrollments[0]).toMatchObject({
        feeCents: 100_000,
        feeOverrideCents: 100_000,
      });
    });

    it('404s for unknown ids and 400s for malformed ones', async () => {
      expectProblem(
        await owner().get(one('0197a8b0-0000-7000-8000-000000000000')),
        404,
        'NOT_FOUND',
      );
      expectProblem(await owner().get(one('not-a-uuid')), 400, 'VALIDATION_FAILED');
    });
  });

  describe('POST /admin/students — STU-03, PAR-01, PAR-03', () => {
    const base = () => ({
      displayName: 'Dinithi Rajapaksha',
      phone: uniquePhone(),
      school: 'Mahamaya Girls College',
      alYear: 2027,
      medium: 'sinhala' as const,
    });

    it('creates an invited student with a number from the counter, guardians and enrolments', async () => {
      invited.length = 0;
      const body = {
        ...base(),
        guardians: [
          { name: 'Mala Rajapaksha', relation: 'mother', phone: '+94770000201' },
          { name: 'Nimal Rajapaksha', relation: 'father', phone: '+94770000202', smsOptIn: false },
        ],
        classIds: [classA],
        enrolFrom: '2026-11-01',
      };
      const res = await owner().post(LIST, body);
      expect(res.status).toBe(201);
      const profile = studentProfileSchema.strict().parse(res.body);
      expect(profile).toMatchObject({
        status: 'invited',
        phone: body.phone,
        school: 'Mahamaya Girls College',
        alYear: 2027,
        medium: 'sinhala',
        under18: false,
        activeDevices: 0,
      });
      expect(profile.studentNo).toMatch(/^[A-Z]{2,4}-26-\d{4,}$/);
      expect(profile.guardians.map((g) => [g.name, g.smsOptIn])).toEqual([
        ['Mala Rajapaksha', true],
        ['Nimal Rajapaksha', false],
      ]);
      expect(profile.enrollments).toEqual([
        expect.objectContaining({ classId: classA, fromMonth: '2026-11-01', toMonth: null }),
      ]);

      // No password until the student sets one with an SMS code (AUTH-07).
      const [user] = await db
        .select()
        .from(schema.tenantUsers)
        .where(eq(schema.tenantUsers.id, profile.id));
      expect(user).toMatchObject({ kind: 'student', status: 'invited', passwordHash: null });

      expect(invited).toEqual([
        {
          tenantId: tenant.id,
          studentId: profile.id,
          displayName: body.displayName,
          phone: body.phone,
        },
      ]);
      // Delivery is connected: a first-password code went out through the sms queue (AUTH-07).
      expect(await smsTo(t, body.phone)).toHaveLength(1);
      expect(await lastCode(t, body.phone)).toMatch(/^\d{6}$/);
      const audits = await f.audits(tenant, 'student.create');
      expect(audits.at(-1)).toMatchObject({
        actorId: staff.owner.user.id,
        actorKind: 'staff',
        entityId: profile.id,
      });
      expect(JSON.stringify(audits.at(-1))).not.toContain(body.phone);
    });

    it('numbers are consecutive and unique, also under concurrency', async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, () => owner().post(LIST, { ...base(), sendWelcomeSms: false })),
      );
      expect(results.map((r) => r.status)).toEqual(Array(6).fill(201));
      const numbers = results
        .map((r) => Number((r.body.studentNo as string).split('-').at(-1)))
        .sort((a, b) => a - b);
      expect(new Set(numbers).size).toBe(6);
      expect(numbers.at(-1)! - numbers[0]!).toBe(5);
    });
    it('uses the joining year across Colombo New Year and preserves existing numbers', async () => {
      const instant = t.clock.now();
      const yearTenant = await f.tenant();
      const yearOwner = await f.staff(yearTenant, ['owner']);
      try {
        t.clock.set(new Date('2026-12-31T18:27:00.000Z'));
        const client = api(t, yearTenant.host, await signInStaff(t, yearTenant, yearOwner));
        t.clock.set(new Date('2026-12-31T18:29:59.999Z'));
        const first = await client.post(LIST, { ...base(), sendWelcomeSms: false });
        t.clock.set(new Date('2026-12-31T18:30:00.000Z'));
        const next = await client.post(LIST, { ...base(), sendWelcomeSms: false });
        expect(first.body.studentNo).toBe(`${yearTenant.prefix}-26-0001`);
        expect(next.body.studentNo).toBe(`${yearTenant.prefix}-27-0001`);
        expect((await client.get(one(first.body.id as string))).body.studentNo).toBe(first.body.studentNo);
      } finally { t.clock.set(instant); }
    });

    it('sends no welcome SMS when sendWelcomeSms is false', async () => {
      invited.length = 0;
      expect((await owner().post(LIST, { ...base(), sendWelcomeSms: false })).status).toBe(201);
      expect(invited).toEqual([]);
    });

    it('requires parental consent for under-18s and stores it (PAR-03)', async () => {
      expectProblem(
        await owner().post(LIST, { ...base(), under18: true }),
        400,
        'VALIDATION_FAILED',
      );
      const res = await owner().post(LIST, {
        ...base(),
        under18: true,
        consent: { givenBy: 'Mala Rajapaksha', method: 'paper_form' },
      });
      expect(res.status).toBe(201);
      expect(res.body.under18).toBe(true);
      expect(res.body.consent).toMatchObject({ givenBy: 'Mala Rajapaksha', method: 'paper_form' });
      const [row] = await db
        .select()
        .from(schema.students)
        .where(eq(schema.students.userId, res.body.id as string));
      expect(row?.consentRecordedBy).toBe(staff.owner.user.id);
    });

    it('rejects a duplicate phone (409), foreign or archived classes (400), too many guardians (400)', async () => {
      expectProblem(
        await owner().post(LIST, { ...base(), phone: s.nimali.phone }),
        409,
        'CONFLICT',
      );
      expectProblem(
        await owner().post(LIST, { ...base(), classIds: [foreignClass] }),
        400,
        'VALIDATION_FAILED',
      );
      expectProblem(
        await owner().post(LIST, { ...base(), classIds: [classArchived] }),
        400,
        'VALIDATION_FAILED',
      );
      const guardian = (n: number) => ({
        name: `G${n}`,
        relation: 'other',
        phone: `+9477000030${n}`,
      });
      expectProblem(
        await owner().post(LIST, { ...base(), guardians: [1, 2, 3, 4].map(guardian) }),
        400,
        'VALIDATION_FAILED',
      );
      expectProblem(
        await owner().post(LIST, {
          ...base(),
          guardians: [guardian(1), { ...guardian(2), phone: guardian(1).phone }],
        }),
        400,
        'VALIDATION_FAILED',
      );
      expectProblem(await owner().post(LIST, { ...base(), nope: 1 }), 400, 'VALIDATION_FAILED');
    });

    it('the same phone may exist at another institute', async () => {
      await f.student(other, { phone: '+94766000001' });
      expect((await owner().post(LIST, { ...base(), phone: '+94766000001' })).status).toBe(201);
    });
  });

  describe('PATCH /admin/students/:id — STU-05', () => {
    it('updates fields, replaces guardians and audits field names only', async () => {
      const student = await f.student(tenant, { name: 'Edit Me' });
      const res = await owner().patch(one(student.id), {
        displayName: 'Edited Name',
        school: 'Vidyartha College',
        alYear: 2028,
        guardians: [{ name: 'New Guardian', relation: 'guardian', phone: '+94770000401' }],
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        displayName: 'Edited Name',
        school: 'Vidyartha College',
        alYear: 2028,
      });
      expect(res.body.guardians).toHaveLength(1);

      const cleared = await owner().patch(one(student.id), { school: null, guardians: [] });
      expect(cleared.body).toMatchObject({ school: null, guardians: [] });

      const audits = (await f.audits(tenant, 'student.update')).filter(
        (a) => a.entityId === student.id,
      );
      expect(audits.map((a) => a.after)).toEqual([
        { fields: ['displayName', 'school', 'alYear', 'guardians'] },
        { fields: ['school', 'guardians'] },
      ]);
    });

    it('changes the phone but never to one already taken', async () => {
      const student = await f.student(tenant);
      expectProblem(
        await owner().patch(one(student.id), { phone: s.nimali.phone }),
        409,
        'CONFLICT',
      );
      const phone = uniquePhone();
      expect((await owner().patch(one(student.id), { phone })).body.phone).toBe(phone);
      // Re-sending the student's own phone is not a conflict.
      expect((await owner().patch(one(student.id), { phone })).status).toBe(200);
    });

    it('marks a student under 18 only with consent', async () => {
      const student = await f.student(tenant);
      expectProblem(
        await owner().patch(one(student.id), { under18: true }),
        400,
        'VALIDATION_FAILED',
      );
      const res = await owner().patch(one(student.id), {
        under18: true,
        consent: { givenBy: 'Parent', method: 'verbal' },
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ under18: true, consent: { method: 'verbal' } });
      // Once recorded, later edits need not repeat it.
      expect((await owner().patch(one(student.id), { school: 'X' })).status).toBe(200);
    });

    it('rejects an empty body and unknown ids', async () => {
      expectProblem(await owner().patch(one(s.nimali.id), {}), 400, 'VALIDATION_FAILED');
      expectProblem(
        await owner().patch(one('0197a8b0-0000-7000-8000-000000000000'), { school: 'x' }),
        404,
        'NOT_FOUND',
      );
    });
  });

  describe('POST /admin/students/bulk — STU-02, STU-07', () => {
    it('archives: hides from the list, ends sessions, audits each student, skips the rest', async () => {
      const student = await f.student(tenant, { name: 'Leaving Student' });
      const cookie = await signInStudent(t, tenant, student);
      const missing = '0197a8b0-0000-7000-8000-000000000001';
      const res = await owner().post(BULK, {
        action: 'archive',
        studentIds: [student.id, s.old.id, missing],
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        affected: 1,
        skipped: expect.arrayContaining([s.old.id, missing]),
      });

      expect((await owner().get(`${LIST}?q=Leaving`)).body.items).toEqual([]);
      const archived = (await owner().get(`${LIST}?status=archived&q=Leaving`)).body.items;
      expect(archived).toHaveLength(1);
      expect((await api(t, tenant.host, cookie).get('/api/v1/me/classes')).status).toBe(401);
      const audits = (await f.audits(tenant, 'student.archive')).filter(
        (a) => a.entityId === student.id,
      );
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ actorId: staff.owner.user.id });
    });

    it('reactivates archived students only', async () => {
      const res = await owner().post(BULK, {
        action: 'reactivate',
        studentIds: [s.old.id, s.nimali.id],
      });
      expect(res.body).toEqual({ affected: 1, skipped: [s.nimali.id] });
      expect((await owner().get(one(s.old.id))).body.archivedAt).toBeNull();
      expect(await f.audits(tenant, 'student.reactivate')).toHaveLength(1);
      // Back to archived so the other tests keep their counts.
      await owner().post(BULK, { action: 'archive', studentIds: [s.old.id] });
    });

    it('signs devices out and ends sessions; students with nothing to end are skipped', async () => {
      const student = await f.student(tenant, { name: 'Two Devices' });
      const cookie = await signInStudent(t, tenant, student);
      const quiet = await f.student(tenant);
      const res = await staff.admin.api.post(BULK, {
        action: 'sign_out_devices',
        studentIds: [student.id, quiet.id],
      });
      expect(res.body).toEqual({ affected: 1, skipped: [quiet.id] });
      const devices = await f.devicesOf(student);
      expect(devices.length).toBeGreaterThan(0);
      for (const d of devices) {
        expect(d.signedOutAt).not.toBeNull();
        expect(d.signedOutBy).toBe(staff.admin.user.id);
      }
      expect((await api(t, tenant.host, cookie).get('/api/v1/me/classes')).status).toBe(401);
      expect(await f.audits(tenant, 'student.devices_sign_out')).toHaveLength(1);
      // A fresh device is allowed again afterwards (the limit counts live devices only).
      expect((await signInStudent(t, tenant, student)).length).toBeGreaterThan(0);
    });

    it('moves students between classes from a month, keeping history and fee overrides', async () => {
      const from = await f.klass(tenant, { name: 'Move From', feeCents: 100_000 });
      const to = await f.klass(tenant, { name: 'Move To', feeCents: 120_000 });
      const midway = await f.student(tenant, { name: 'Midway' });
      const sameMonth = await f.student(tenant, { name: 'Same Month' });
      const outsider = await f.student(tenant, { name: 'Outsider' });
      const already = await f.student(tenant, { name: 'Already There' });
      await f.enroll(tenant, midway.id, from, { from: '2026-01-01', feeOverrideCents: 50_000 });
      await f.enroll(tenant, sameMonth.id, from, { from: '2026-11-01' });
      await f.enroll(tenant, already.id, from, { from: '2026-01-01' });
      await f.enroll(tenant, already.id, to, { from: '2026-01-01' });

      const res = await owner().post(BULK, {
        action: 'move_class',
        studentIds: [midway.id, sameMonth.id, outsider.id, already.id],
        fromClassId: from,
        toClassId: to,
        fromMonth: '2026-11-01',
      });
      expect(res.body, res.text).toMatchObject({ affected: 2 });
      expect((res.body.skipped as string[]).sort()).toEqual([outsider.id, already.id].sort());

      const rows = await db
        .select()
        .from(schema.enrollments)
        .where(inArray(schema.enrollments.studentId, [midway.id, sameMonth.id]));
      const of = (id: string) =>
        rows
          .filter((r) => r.studentId === id)
          .map((r) => [
            r.classId === from ? 'from' : 'to',
            r.fromMonth,
            r.toMonth,
            r.feeOverrideCents,
          ])
          .sort();
      expect(of(midway.id)).toEqual([
        ['from', '2026-01-01', '2026-10-01', 50_000],
        ['to', '2026-11-01', null, 50_000],
      ]);
      expect(of(sameMonth.id)).toEqual([['to', '2026-11-01', null, null]]);
      expect(await f.audits(tenant, 'student.move_class')).toHaveLength(2);
    });

    it('rejects moves into archived or foreign classes and to the same class', async () => {
      const move = (toClassId: string, fromClassId = classA) =>
        owner().post(BULK, {
          action: 'move_class',
          studentIds: [s.nimali.id],
          fromClassId,
          toClassId,
          fromMonth: '2026-11-01',
        });
      expectProblem(await move(classArchived), 400, 'VALIDATION_FAILED');
      expectProblem(await move(foreignClass), 400, 'VALIDATION_FAILED');
      expectProblem(await move(classA), 400, 'VALIDATION_FAILED');
    });

    it('validates the action union and id lists', async () => {
      expectProblem(
        await owner().post(BULK, { action: 'delete', studentIds: [] }),
        400,
        'VALIDATION_FAILED',
      );
      expectProblem(
        await owner().post(BULK, { action: 'archive', studentIds: [] }),
        400,
        'VALIDATION_FAILED',
      );
    });
  });

  describe('cross-tenant isolation', () => {
    it("another institute's students are invisible, immutable and not bulk-actionable", async () => {
      const foreign = await f.student(other, { name: 'Foreign Student' });
      const mine = await f.student(tenant, { name: 'Mine' });
      expect((await owner().get(`${LIST}?q=Foreign`)).body.items).toEqual([]);
      expectProblem(await owner().get(one(foreign.id)), 404, 'NOT_FOUND');
      expectProblem(await owner().patch(one(foreign.id), { school: 'Hacked' }), 404, 'NOT_FOUND');

      for (const action of ['archive', 'reactivate'] as const) {
        const res = await owner().post(BULK, { action, studentIds: [foreign.id, mine.id] });
        expect(res.body.skipped).toContain(foreign.id);
      }
      const [row] = await db
        .select()
        .from(schema.students)
        .where(eq(schema.students.userId, foreign.id));
      expect(row?.archivedAt).toBeNull();
      expect(row?.school).toBeNull();

      // Cannot enrol a new student in, or move students into, a foreign class.
      expectProblem(
        await owner().post(BULK, {
          action: 'move_class',
          studentIds: [foreign.id],
          fromClassId: classA,
          toClassId: foreignClass,
          fromMonth: '2026-11-01',
        }),
        400,
        'VALIDATION_FAILED',
      );
    });

    it("another institute's staff session is no session here", async () => {
      const foreignOwner = await f.staff(other, ['owner']);
      const cookie = await signInStaff(t, other, foreignOwner);
      expectProblem(await api(t, tenant.host, cookie).get(LIST), 401, 'UNAUTHENTICATED');
    });
  });

  describe('permissions per role', () => {
    const can = {
      read: ['owner', 'admin', 'teacher', 'cashier', 'gatekeeper'],
      write: ['owner', 'admin'],
    };

    it.each(can.read)('%s may list and open students', async (role) => {
      const who = staff[role as StaffRole];
      expect((await who.api.get(LIST)).status).toBe(200);
      const opened = await who.api.get(one(s.nimali.id));
      // The scoped teacher's class contains Nimali too.
      expect(opened.status).toBe(200);
    });

    it.each(['teacher', 'cashier', 'gatekeeper'] as const)('%s cannot write', async (role) => {
      const who = staff[role];
      const id = s.nimali.id;
      expectProblem(
        await who.api.post(LIST, { displayName: 'X Y', phone: uniquePhone() }),
        403,
        'FORBIDDEN',
      );
      expectProblem(await who.api.patch(one(id), { school: 'Nope' }), 403, 'FORBIDDEN');
      expectProblem(
        await who.api.post(BULK, { action: 'archive', studentIds: [id] }),
        403,
        'FORBIDDEN',
      );
      expectProblem(
        await who.api.post(BULK, { action: 'sign_out_devices', studentIds: [id] }),
        403,
        'FORBIDDEN',
      );
      const [row] = await db.select().from(schema.students).where(eq(schema.students.userId, id));
      expect(row?.archivedAt).toBeNull();
      expect(row?.school).not.toBe('Nope');
    });

    it('a student session is refused everywhere (403) and anonymous is 401', async () => {
      const cookie = await signInStudent(t, tenant, s.hiruni);
      const as = api(t, tenant.host, cookie);
      expectProblem(await as.get(LIST), 403, 'FORBIDDEN');
      expectProblem(await as.get(one(s.nimali.id)), 403, 'FORBIDDEN');
      expectProblem(
        await as.post(LIST, { displayName: 'X Y', phone: uniquePhone() }),
        403,
        'FORBIDDEN',
      );
      expectProblem(await api(t, tenant.host).get(LIST), 401, 'UNAUTHENTICATED');
    });

    it('admins write, including device sign-out', async () => {
      const res = await staff.admin.api.post(LIST, {
        displayName: 'Admin Made',
        phone: uniquePhone(),
        sendWelcomeSms: false,
      });
      expect(res.status).toBe(201);
    });
  });

  it('every student query stays tenant-bound: counts match the database', async () => {
    const n = await db.$count(
      schema.students,
      and(eq(schema.students.tenantId, tenant.id), isNull(schema.students.archivedAt)),
    );
    expect((await owner().get(`${LIST}?pageSize=100`)).body.total).toBe(n);
  });
});
