import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, withTenant, type Db } from '@remix/db';
import { can } from '@remix/types';
import {
  cardLookupResponseSchema,
  studentCardSchema,
  studentCardsResponseSchema,
  orderedCardsResponseSchema,
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
import { api, signInStaff, signInStudent, staffByRole, type Api } from './support/people';

const list = (id: string) => `/api/v1/admin/students/${id}/cards`;
const activate = (id: string) => `/api/v1/admin/cards/${id}/activate`;
const revoke = (id: string) => `/api/v1/admin/cards/${id}/revoke`;
const ORDERED = '/api/v1/admin/cards/ordered';
const LOOKUP = '/api/v1/admin/cards/lookup';

describe('STU-06 cards against Postgres and the real permission pipeline', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  let tenant: TenantFixture;
  let other: TenantFixture;
  let staff: Record<StaffRole, { user: UserFixture; api: Api }>;
  let studentApi: Api;
  let unprivileged: Api;
  let student: UserFixture;
  let foreign: UserFixture;
  let foreignCard: ReturnType<typeof studentCardSchema.parse>;
  const owner = () => staff.owner.api;
  const issue = async (
    id: string,
    kind: 'temporary' | 'permanent' = 'temporary',
    formats = ['barcode'],
  ) => {
    const res = await owner().post(list(id), kind === 'temporary' ? { kind } : { kind, formats });
    expect(res.status).toBe(201);
    return studentCardSchema.strict().parse(res.body);
  };
  beforeAll(async () => {
    t = await createDbTestApp();
    db = ownerDb();
    f = new Factory(db);
    tenant = await f.tenant();
    other = await f.tenant();
    staff = await staffByRole(t, f, tenant);
    student = await f.student(tenant);
    foreign = await f.student(other);
    studentApi = api(t, tenant.host, await signInStudent(t, tenant, student));
    const noRole = await f.staff(tenant, []);
    unprivileged = api(t, tenant.host, await signInStaff(t, tenant, noRole));
    const foreignStaff = await staffByRole(t, f, other, ['owner']);
    foreignCard = studentCardSchema.parse(
      (
        await foreignStaff.owner.api.post(list(foreign.id), {
          kind: 'permanent',
          formats: ['barcode', 'nfc'],
        })
      ).body,
    );
    expect(
      (await foreignStaff.owner.api.post(activate(foreignCard.id), { nfcUid: '04AABBCC' })).status,
    ).toBe(200);
  });
  afterAll(async () => {
    await t.close();
    await db.$client.end();
  });

  for (const role of ['owner', 'admin', 'teacher', 'cashier', 'gatekeeper'] as const)
    it(`${role}: read/list/lookup and permission-checked mutations`, async () => {
      const target = await f.student(tenant);
      const temp = await issue(target.id);
      const ordered = await issue(target.id, 'permanent');
      const who = staff[role].api;
      expect((await who.get(list(target.id))).status).toBe(200);
      expect((await who.get(ORDERED)).status).toBe(200);
      expect((await who.post(LOOKUP, { input: temp.code })).status).toBe(200);
      if (can([role], 'students.write')) {
        expect((await who.post(activate(ordered.id))).status).toBe(200);
        expect((await who.post(revoke(ordered.id), { reason: 'Lost card' })).status).toBe(200);
        expect((await who.post(list(target.id), { kind: 'temporary' })).status).toBe(201);
      } else {
        for (const [path, body] of [
          [list(target.id), { kind: 'temporary' }],
          [activate(ordered.id), {}],
          [revoke(temp.id), { reason: 'Lost card' }],
        ] as const)
          expectProblem(await who.post(path, body), 403, 'FORBIDDEN');
      }
    });

  it('students and staff with no students.read get 403 at every endpoint', async () => {
    const temp = await issue(student.id);
    for (const who of [studentApi, unprivileged]) {
      expectProblem(await who.get(list(student.id)), 403, 'FORBIDDEN');
      expectProblem(await who.get(ORDERED), 403, 'FORBIDDEN');
      for (const [path, body] of [
        [LOOKUP, { input: temp.code }],
        [list(student.id), { kind: 'temporary' }],
        [activate(temp.id), {}],
        [revoke(temp.id), { reason: 'Lost card' }],
      ] as const)
        expectProblem(await who.post(path, body), 403, 'FORBIDDEN');
    }
  });

  it('foreign student/card IDs and foreign card code, number and UID all return 404', async () => {
    expectProblem(await owner().get(list(foreign.id)), 404, 'NOT_FOUND');
    expectProblem(await owner().post(list(foreign.id), { kind: 'temporary' }), 404, 'NOT_FOUND');
    expectProblem(await owner().post(activate(foreignCard.id)), 404, 'NOT_FOUND');
    expectProblem(
      await owner().post(revoke(foreignCard.id), { reason: 'Lost card' }),
      404,
      'NOT_FOUND',
    );
    const [profile] = await db
      .select()
      .from(schema.students)
      .where(eq(schema.students.userId, foreign.id));
    for (const input of [foreignCard.code, profile!.studentNo, '04AABBCC'])
      expectProblem(await owner().post(LOOKUP, { input }), 404, 'NOT_FOUND');
    expect(
      orderedCardsResponseSchema
        .parse((await owner().get(ORDERED)).body)
        .items.some((c) => c.id === foreignCard.id),
    ).toBe(false);
  });

  it('temporary replaces active atomically, ordering leaves it untouched, handover revokes it', async () => {
    const target = await f.student(tenant);
    const first = await issue(target.id);
    const temp = await issue(target.id);
    expect(temp.code).toBe(first.code.slice(0, -1) + '2');
    const permanent = await issue(target.id, 'permanent', ['barcode', 'qr', 'nfc']);
    let history = studentCardsResponseSchema.parse((await owner().get(list(target.id))).body).items;
    expect(history.map((c) => c.status)).toEqual(['ordered', 'active', 'revoked']);
    expect(history[2]?.revokeReason).toBe('replaced');
    const handed = await owner().post(activate(permanent.id), { nfcUid: '04:a2:1b:9c' });
    expect(handed.status).toBe(200);
    const active = studentCardSchema.strict().parse(handed.body);
    expect(active).toMatchObject({ status: 'active', nfcUidHint: '\u2022\u2022\u2022\u20221B9C' });
    expect(active.activatedAt).not.toBeNull();
    history = studentCardsResponseSchema.parse((await owner().get(list(target.id))).body).items;
    expect(history.map((c) => c.status)).toEqual(['active', 'revoked', 'revoked']);
    expectProblem(await owner().post(activate(permanent.id)), 409, 'CONFLICT');
    expect((await owner().post(revoke(permanent.id), { reason: 'Lost chip' })).status).toBe(200);
    expectProblem(await owner().post(revoke(permanent.id), { reason: 'Again' }), 409, 'CONFLICT');
    const lookup = cardLookupResponseSchema
      .strict()
      .parse((await owner().post(LOOKUP, { input: '04A21B9C' })).body);
    expect(lookup.card).toMatchObject({ id: permanent.id, status: 'revoked' });
    const another = await f.student(tenant);
    const pending = await issue(another.id, 'permanent', ['barcode', 'nfc']);
    expectProblem(
      await owner().post(activate(pending.id), { nfcUid: '04A21B9C' }),
      409,
      'CONFLICT',
    );
    expect((await owner().post(LOOKUP, { input: temp.code })).body.card).toMatchObject({
      id: temp.id,
      status: 'revoked',
    });
    expect(JSON.stringify(await f.audits(tenant))).not.toContain('04A21B9C');
    expect(t.logs.text).not.toContain('04A21B9C');
    expect(t.logs.text).not.toContain('04:a2:1b:9c');
    expect(JSON.stringify(handed.body)).not.toContain('04A21B9C');
  });

  it('one ordered and active card under concurrency, monotonic sequences and no UID leak on conflicts', async () => {
    const target = await f.student(tenant);
    const temps = await Promise.all(
      Array.from({ length: 6 }, () => owner().post(list(target.id), { kind: 'temporary' })),
    );
    expect(temps.map((r) => r.status)).toEqual(Array(6).fill(201));
    expect(new Set(temps.map((r) => studentCardSchema.parse(r.body).code)).size).toBe(6);
    const orders = await Promise.all(
      Array.from({ length: 5 }, () =>
        owner().post(list(target.id), { kind: 'permanent', formats: ['barcode', 'nfc'] }),
      ),
    );
    expect(orders.filter((r) => r.status === 201)).toHaveLength(1);
    expect(orders.filter((r) => r.status === 409)).toHaveLength(4);
    const history = studentCardsResponseSchema.parse(
      (await owner().get(list(target.id))).body,
    ).items;
    expect(history.filter((c) => c.status === 'active')).toHaveLength(1);
    expect(history.filter((c) => c.status === 'ordered')).toHaveLength(1);
    const cards = await Promise.all([f.student(tenant), f.student(tenant)]);
    const pending = await Promise.all(
      cards.map((s) => issue(s.id, 'permanent', ['barcode', 'nfc'])),
    );
    const claims = await Promise.all(
      pending.map((c) => owner().post(activate(c.id), { nfcUid: '11223344556677' })),
    );
    expect(claims.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(claims.map((r) => JSON.stringify(r.body)).join()).not.toContain('11223344556677');
    expect(t.logs.text).not.toContain('11223344556677');
  });

  it('validates formats/UID inputs, rejects archived issue and supports cancelled orders', async () => {
    const archived = await f.student(tenant, { archived: true });
    expectProblem(
      await owner().post(list(archived.id), { kind: 'temporary' }),
      400,
      'VALIDATION_FAILED',
    );
    const target = await f.student(tenant);
    for (const body of [
      { kind: 'permanent', formats: ['qr'] },
      { kind: 'temporary', formats: ['barcode'] },
      { kind: 'permanent', formats: ['barcode', 'barcode'] },
    ])
      expectProblem(await owner().post(list(target.id), body), 400, 'VALIDATION_FAILED');
    const pending = await issue(target.id, 'permanent');
    expectProblem(
      await owner().post(activate(pending.id), { nfcUid: '11223344' }),
      400,
      'VALIDATION_FAILED',
    );
    expectProblem(
      await owner().post(activate(pending.id), { nfcUid: 'invalid' }),
      400,
      'VALIDATION_FAILED',
    );
    expect((await owner().post(revoke(pending.id), { reason: 'Cancelled order' })).status).toBe(
      200,
    );
    const cancelled = studentCardSchema.parse((await owner().get(list(target.id))).body.items[0]);
    expect(cancelled.activatedAt).toBeNull();
    await issue(target.id, 'permanent');
  });

  it('looks up card before bare student number, preserves dashes and resolves ordered/archived states', async () => {
    const target = await f.student(tenant);
    const card = await issue(target.id, 'permanent');
    const collision = await f.student(tenant);
    await db
      .update(schema.students)
      .set({ studentNo: card.code })
      .where(eq(schema.students.userId, collision.id));
    const found = await owner().post(LOOKUP, { input: '  ' + card.code.toLowerCase() + '  ' });
    expect(found.headers['cache-control']).toBe('no-store');
    expect(found.body).toMatchObject({
      matchedBy: 'card',
      card: { id: card.id, status: 'ordered' },
      student: { id: target.id },
    });
    const [profile] = await db
      .select()
      .from(schema.students)
      .where(eq(schema.students.userId, target.id));
    expect((await owner().post(LOOKUP, { input: profile!.studentNo })).body).toMatchObject({
      matchedBy: 'studentNo',
      card: null,
    });
    expectProblem(
      await owner().post(LOOKUP, { input: card.code.replace(/-(\d+)$/, '$1') }),
      404,
      'NOT_FOUND',
    );
    await db
      .update(schema.students)
      .set({ archivedAt: t.clock.now() })
      .where(eq(schema.students.userId, target.id));
    expect((await owner().post(LOOKUP, { input: card.code })).body.student.archived).toBe(true);
    const audits = await f.audits(tenant);
    expect(audits.some((a) => a.action.includes('lookup'))).toBe(false);
  });

  it('ordered list is oldest first and includes names and numbers without UIDs', async () => {
    const res = await staff.cashier.api.get(ORDERED);
    expect(res.headers['cache-control']).toBe('no-store');
    const rows = orderedCardsResponseSchema.strict().parse(res.body).items;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.displayName).toBeTruthy();
    expect(rows.map((c) => c.issuedAt)).toEqual(rows.map((c) => c.issuedAt).sort());
    expect(JSON.stringify(res.body)).not.toContain('nfcUid');
  });

  it('normalises legacy numbers for lookup and card codes, preserving display spelling', async () => {
    const target = await f.student(tenant);
    await db
      .update(schema.students)
      .set({ studentNo: ' old - 77 ' })
      .where(eq(schema.students.userId, target.id));
    const card = await issue(target.id);
    expect(card.code).toBe('OLD-77-1');
    for (const input of ['old-77', ' OLD - 77 ']) {
      const res = await owner().post(LOOKUP, { input });
      expect(res.body).toMatchObject({
        matchedBy: 'studentNo',
        student: { id: target.id, studentNo: ' old - 77 ' },
      });
    }
    expect((await owner().post(LOOKUP, { input: ' old -77 - 1 ' })).body.card.id).toBe(card.id);
    expect(t.logs.text).not.toContain(' old -77 - 1 ');
  });

  it('refuses card issue when the normalised number is short or outside visible ASCII', async () => {
    for (const studentNo of [
      ' x ',
      'සිසු-01',
      '\u00a0\u00a0',
      'old\u00a0-77',
      'old\ufeff-78',
      'straße',
    ]) {
      const target = await f.student(tenant);
      await db
        .update(schema.students)
        .set({ studentNo })
        .where(eq(schema.students.userId, target.id));
      const res = await owner().post(list(target.id), { kind: 'temporary' });
      expectProblem(res, 400, 'VALIDATION_FAILED');
      expect(res.body.title).toBe(
        'This student number cannot be printed on a card; change it first',
      );
      expect((await owner().get(list(target.id))).body.items).toEqual([]);
    }
  });

  it('limits lookups per staff session to 60/minute, including misses', async () => {
    t.clock.advance(60_001);
    const attempts = await Promise.all(
      Array.from({ length: 61 }, () => staff.cashier.api.post(LOOKUP, { input: 'UNKNOWN' })),
    );
    expect(attempts.filter((r) => r.status === 404)).toHaveLength(60);
    const limited = attempts.find((r) => r.status === 429);
    expect(limited?.headers['retry-after']).toBeTruthy();
    expect(limited?.headers['cache-control']).toBe('no-store');
    const cookie = await signInStaff(t, tenant, staff.cashier.user);
    expect((await api(t, tenant.host, cookie).post(LOOKUP, { input: 'UNKNOWN' })).status).toBe(404);
    const rows = await withTenant(db, tenant.id, (tx) =>
      tx
        .select()
        .from(schema.studentCards)
        .where(
          and(
            eq(schema.studentCards.studentId, student.id),
            eq(schema.studentCards.status, 'active'),
          ),
        ),
    );
    expect(rows).toHaveLength(1);
  });
});
