import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@remix/db';
import { myClassesResponseSchema } from '@remix/types/api';
import { expectProblem } from '../fixtures/problem';
import {
  client,
  cookieValue,
  createDbTestApp,
  Factory,
  ownerDb,
  PASSWORD,
  setCookies,
  type DbTestApp,
  type TenantFixture,
  type UserFixture,
} from './support/db-app';

const CLASSES = '/api/v1/me/classes';

describe('GET /api/v1/me/classes against Postgres', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  let tenant: TenantFixture;
  let other: TenantFixture;
  let student: UserFixture;
  let teacher: UserFixture;
  let cookie: string;

  beforeAll(async () => {
    t = await createDbTestApp();
    db = ownerDb();
    f = new Factory(db);
    tenant = await f.tenant('active');
    other = await f.tenant('active');
    teacher = await f.staff(tenant, ['teacher'], { name: 'Kamal Jayasinghe' });
    student = await f.student(tenant);

    const theory = await f.klass(tenant, {
      name: '2027 A/L Physics Theory',
      feeCents: 250_000,
      teacherId: teacher.id,
      schedules: [
        [6, '08:00', 180],
        [3, '19:00', 120],
      ],
    });
    const revision = await f.klass(tenant, { name: '2027 A/L Revision', feeCents: 150_000 });
    const ended = await f.klass(tenant, { name: '2026 A/L Paper Class', feeCents: 200_000 });
    const future = await f.klass(tenant, { name: '2027 A/L Model Papers', feeCents: 100_000 });
    const archived = await f.klass(tenant, {
      name: '2025 A/L Old Class',
      feeCents: 100_000,
      archived: true,
    });
    await f.enroll(tenant, student.id, theory, { from: '2026-01-01' });
    await f.enroll(tenant, student.id, revision, {
      from: '2026-09-01',
      to: '2026-10-01',
      feeOverrideCents: 75_000,
    });
    await f.enroll(tenant, student.id, ended, { from: '2026-01-01', to: '2026-09-01' });
    await f.enroll(tenant, student.id, future, { from: '2026-11-01' });
    await f.enroll(tenant, student.id, archived, { from: '2026-01-01' });

    // Another tenant's class (and student with the same phone) must never appear.
    const foreign = await f.klass(other, { name: 'AAA Foreign Class', feeCents: 1 });
    const twin = await f.student(other, { phone: student.phone });
    await f.enroll(other, twin.id, foreign, { from: '2026-01-01' });

    const res = await client(t, tenant.host).post('/api/v1/auth/student/login', {
      phone: student.phone,
      password: PASSWORD,
      staySignedIn: true,
    });
    cookie = `remix_session=${cookieValue(setCookies(res).get('remix_session'))}`;
  });
  afterAll(async () => {
    await t.close();
    await db.$client.end();
  });

  it('lists this month’s classes with teacher, fee (override applied) and schedule, ordered', async () => {
    // 15 October 2026, 10:00 Colombo.
    const res = await client(t, tenant.host).get(CLASSES, cookie);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = myClassesResponseSchema.strict().parse(res.body);
    expect(body.items.map((c) => ({ ...c, id: undefined }))).toEqual([
      {
        name: '2027 A/L Physics Theory',
        grade: '2027 A/L',
        medium: 'sinhala',
        teacherName: 'Kamal Jayasinghe',
        feeCents: 250_000,
        place: 'hall',
        schedule: [
          { weekday: 3, startTime: '19:00', durationMinutes: 120 },
          { weekday: 6, startTime: '08:00', durationMinutes: 180 },
        ],
        id: undefined,
      },
      {
        name: '2027 A/L Revision',
        grade: '2027 A/L',
        medium: 'sinhala',
        teacherName: null,
        feeCents: 75_000,
        place: 'hall',
        schedule: [],
        id: undefined,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('Foreign');
  });

  it('uses the Colombo month: 31 Oct 23:59 Colombo is October, 00:00 is November', async () => {
    // 2026-10-31T18:29:59Z = 23:59:59 on 31 Oct in Colombo (UTC is still 31 Oct either way).
    t.clock.set(new Date('2026-10-31T18:29:59Z'));
    const october = await client(t, tenant.host).get(CLASSES, cookie);
    expect((october.body as { items: { name: string }[] }).items.map((c) => c.name)).toEqual([
      '2027 A/L Physics Theory',
      '2027 A/L Revision',
    ]);

    t.clock.set(new Date('2026-10-31T18:30:00Z')); // 00:00 on 1 Nov in Colombo
    const november = await client(t, tenant.host).get(CLASSES, cookie);
    expect((november.body as { items: { name: string }[] }).items.map((c) => c.name)).toEqual([
      '2027 A/L Model Papers',
      '2027 A/L Physics Theory',
    ]);
  });

  it('is student-only: staff get 403 FORBIDDEN', async () => {
    const res = await client(t, tenant.host).post('/api/v1/auth/staff/login', {
      identifier: teacher.phone,
      password: PASSWORD,
    });
    const staffCookie = `remix_session=${cookieValue(setCookies(res).get('remix_session'))}`;
    expectProblem(await client(t, tenant.host).get(CLASSES, staffCookie), 403, 'FORBIDDEN');
  });

  it('needs a session (401) and never answers on another tenant’s host', async () => {
    expectProblem(await client(t, tenant.host).get(CLASSES), 401, 'UNAUTHENTICATED');
    expectProblem(await client(t, other.host).get(CLASSES, cookie), 401, 'UNAUTHENTICATED');
  });

  it('an empty list for a student with no current enrolments', async () => {
    const lonely = await f.student(tenant);
    const res = await client(t, tenant.host).post('/api/v1/auth/student/login', {
      phone: lonely.phone,
      password: PASSWORD,
    });
    const c = `remix_session=${cookieValue(setCookies(res).get('remix_session'))}`;
    const list = await client(t, tenant.host).get(CLASSES, c);
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ items: [] });
  });
});
