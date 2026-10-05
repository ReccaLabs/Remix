import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@remix/db';
import { feeSettingsSchema, type StaffRole } from '@remix/types/api';
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

const PATH = '/api/v1/admin/settings/fees';
const BANK = {
  bankName: 'Sample Bank',
  branch: 'Colombo',
  accountNumber: '1234567890',
  accountName: 'Sample Institute',
};
const DEFAULTS = {
  dueDay: 5,
  remindersEnabled: false,
  remindBeforeDays: 0,
  remindAfterDays: 1,
  bankDetails: null,
  receipt: { address: null, phone: null, footer: null },
};
describe('SET-03 FEE-09 FEE-12 fee settings against Postgres', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  let tenant: TenantFixture;
  let other: TenantFixture;
  let staff: Record<StaffRole, { user: UserFixture; api: Api }>;
  beforeAll(async () => {
    t = await createDbTestApp();
    db = ownerDb();
    f = new Factory(db);
    tenant = await f.tenant();
    other = await f.tenant();
    staff = await staffByRole(t, f, tenant);
  });
  afterAll(async () => {
    await t.close();
    await db.$client.end();
  });
  it('reads defaults and saves bounded settings with an audit trail', async () => {
    const initial = await staff.owner.api.get(PATH);
    expect(initial.status).toBe(200);
    expect(initial.body).toEqual(DEFAULTS);
    expect(initial.headers['cache-control']).toBe('no-store');
    const body = {
      dueDay: 28,
      remindersEnabled: true,
      remindBeforeDays: 10,
      remindAfterDays: 30,
      bankDetails: BANK,
      receipt: { address: '  Sample Road  ', phone: '+94771234567', footer: 'Thank you' },
    };
    const res = await staff.owner.api.patch(PATH, body);
    expect(res.status).toBe(200);
    expect(feeSettingsSchema.strict().parse(res.body)).toEqual({
      ...body,
      receipt: { ...body.receipt, address: 'Sample Road' },
    });
    expect((await staff.owner.api.get(PATH)).body).toEqual(res.body);
    const audit = (await f.audits(tenant, 'settings.fees_update'))[0];
    expect(audit?.actorId).toBe(staff.owner.user.id);
    expect(JSON.stringify(audit)).not.toContain(BANK.accountNumber);
    expect(JSON.stringify(audit)).not.toContain(body.receipt.phone);
  });
  it('preserves omitted nested template fields, clears with null, and serializes concurrent patches', async () => {
    await Promise.all([
      staff.owner.api.patch(PATH, { receipt: { footer: null } }),
      staff.owner.api.patch(PATH, { receipt: { address: 'New address' } }),
    ]);
    expect((await staff.owner.api.get(PATH)).body.receipt).toEqual({
      footer: null,
      address: 'New address',
      phone: '+94771234567',
    });
    expect(
      (await staff.owner.api.patch(PATH, { bankDetails: null, receipt: { phone: null } })).body
        .bankDetails,
    ).toBeNull();
  });
  it('rejects invalid or unknown fields at every bound', async () => {
    for (const body of [
      {},
      { dueDay: 0 },
      { dueDay: 29 },
      { remindBeforeDays: 11 },
      { remindAfterDays: 0 },
      { remindAfterDays: 31 },
      { receipt: { footer: 'x'.repeat(201) } },
      { receipt: { phone: 'x'.repeat(41) } },
      { bankDetails: { ...BANK, extra: true } },
      { unlockBeforeDue: true },
    ]) {
      expectProblem(await staff.owner.api.patch(PATH, body), 400, 'VALIDATION_FAILED');
    }
  });
  it('owner only: fees.read does not grant money settings access', async () => {
    for (const role of ['admin', 'teacher', 'cashier', 'gatekeeper'] as const) {
      expectProblem(await staff[role].api.get(PATH), 403, 'FORBIDDEN');
      expectProblem(await staff[role].api.patch(PATH, { dueDay: 3 }), 403, 'FORBIDDEN');
    }
    const student = api(t, tenant.host, await signInStudent(t, tenant, await f.student(tenant)));
    expectProblem(await student.get(PATH), 403, 'FORBIDDEN');
    expectProblem(await student.patch(PATH, { dueDay: 3 }), 403, 'FORBIDDEN');
    expectProblem(await api(t, tenant.host).get(PATH), 401, 'UNAUTHENTICATED');
  });
  it('keeps foreign settings independent and denies host-swapped sessions for both endpoints', async () => {
    const user = await f.staff(other, ['owner']);
    const cookie = await signInStaff(t, other, user);
    expect((await api(t, other.host, cookie).get(PATH)).body).toEqual(DEFAULTS);
    expect((await api(t, other.host, cookie).patch(PATH, { dueDay: 2 })).body.dueDay).toBe(2);
    expect((await staff.owner.api.get(PATH)).body.dueDay).toBe(28);
    expectProblem(await api(t, tenant.host, cookie).get(PATH), 401, 'UNAUTHENTICATED');
    expectProblem(
      await api(t, tenant.host, cookie).patch(PATH, { dueDay: 2 }),
      401,
      'UNAUTHENTICATED',
    );
  });
});
