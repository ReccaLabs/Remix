import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, withTenant, type Db } from '@remix/db';
import { checkoutResponseSchema, payhereSettingsSchema, type StaffRole } from '@remix/types/api';
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

const PATH = '/api/v1/admin/settings/payhere';
const SECRET = 'test-only-merchant-secret-a1b2';
describe('SET-02 PayHere settings against Postgres RLS', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  let tenant: TenantFixture;
  let other: TenantFixture;
  let staff: Record<StaffRole, { user: UserFixture; api: Api }>;
  beforeAll(async () => {
    t = await createDbTestApp({ INTEGRATIONS_KEY: randomBytes(32).toString('base64') });
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
  it('returns safe defaults, encrypts the write-only secret, masks reads and audits only nonsecret fields', async () => {
    const initial = await staff.owner.api.get(PATH);
    expect(initial.status).toBe(200);
    expect(initial.headers['cache-control']).toBe('no-store');
    expect(payhereSettingsSchema.strict().parse(initial.body)).toEqual({
      enabled: false,
      mode: 'sandbox',
      merchantId: null,
      secretHint: null,
      lastTest: null,
    });
    const res = await staff.owner.api.patch(PATH, {
      merchantId: '1211234',
      merchantSecret: SECRET,
      enabled: true,
    });
    expect(res.status, t.logs.text).toBe(200);
    expect(payhereSettingsSchema.strict().parse(res.body)).toMatchObject({
      secretHint: '••••a1b2',
      enabled: true,
      merchantId: '1211234',
    });
    const [row] = await withTenant(db, tenant.id, (tx) =>
      tx.select().from(schema.tenantIntegrations),
    );
    expect(row!.secretCiphertext!.includes(Buffer.from(SECRET))).toBe(false);
    expect(row!.secretNonce).toHaveLength(12);
    expect(row!.keyId).toBe('v1');
    expect(JSON.stringify(row!.config)).not.toContain('secret');
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    const audit = await f.audits(tenant, 'settings.payhere_update');
    expect(audit[0]?.after).toMatchObject({ secretChanged: true });
    expect(JSON.stringify(audit)).not.toContain(SECRET);
    expect(JSON.stringify(audit)).not.toContain('a1b2');
    expect(t.logs.text).not.toContain(SECRET);
    const again = await staff.owner.api.get(PATH);
    expect(again.body).toEqual(res.body);
  });
  it('preserves omitted secret and generates a fresh nonce when replacing it', async () => {
    const rows = () =>
      withTenant(db, tenant.id, (tx) => tx.select().from(schema.tenantIntegrations));
    const before = (await rows())[0]!;
    expect((await staff.owner.api.patch(PATH, { mode: 'live' })).body.secretHint).toBe('••••a1b2');
    expect((await rows())[0]!.secretNonce).toEqual(before.secretNonce);
    await staff.owner.api.patch(PATH, { merchantSecret: SECRET });
    expect((await rows())[0]!.secretNonce).not.toEqual(before.secretNonce);
  });
  it('returns a signed LKR 10 checkout and records pending, never paid from redirects', async () => {
    const res = await staff.owner.api.post(`${PATH}/test`);
    expect(res.status, t.logs.text).toBe(200);
    const body = checkoutResponseSchema.strict().parse(res.body);
    expect(body.fields).toMatchObject({
      amount: '10.00',
      currency: 'LKR',
      merchant_id: '1211234',
      order_id: body.checkoutId,
    });
    expect(body.fields.hash).toMatch(/^[A-F0-9]{32}$/);
    for (const key of ['first_name', 'last_name', 'email', 'phone', 'address', 'city', 'country']) {
      expect(body.fields[key]?.trim().length, key).toBeGreaterThan(0);
    }
    expect(body.actionUrl).toBe('https://www.payhere.lk/pay/checkout');
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect((await staff.owner.api.get(PATH)).body.lastTest).toMatchObject({ status: 'pending' });
    expect(t.logs.text).not.toContain(SECRET);
    expect(JSON.stringify(await f.audits(tenant, 'settings.payhere_test'))).not.toContain(SECRET);
  });
  it('requires the testing owner to have both buyer contact fields without recording a test', async () => {
    const user = await f.staff(tenant, ['owner'], { name: 'Mononym' });
    const owner = api(t, tenant.host, await signInStaff(t, tenant, user));
    const before = (await owner.get(PATH)).body.lastTest;
    const audits = await f.audits(tenant, 'settings.payhere_test');
    for (const contact of [{ phone: null }, { phone: user.phone, email: null }]) {
      await withTenant(db, tenant.id, (tx) =>
        tx.update(schema.tenantUsers).set(contact).where(eq(schema.tenantUsers.id, user.id)),
      );
      expectProblem(await owner.post(`${PATH}/test`), 400, 'VALIDATION_FAILED');
    }
    expect((await owner.get(PATH)).body.lastTest).toEqual(before);
    expect(await f.audits(tenant, 'settings.payhere_test')).toHaveLength(audits.length);
  });
  it('rejects unknown fields, malformed inputs and enabling/testing without credentials', async () => {
    for (const body of [
      { merchantId: 'abc' },
      { merchantSecret: 'short' },
      { mode: 'invalid' },
      { secretHint: SECRET },
    ]) {
      const res = await staff.owner.api.patch(PATH, body);
      expectProblem(res, 400, 'VALIDATION_FAILED');
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    }
    const foreign = await staffByRole(t, f, other, ['owner']);
    expectProblem(await foreign.owner.api.patch(PATH, { enabled: true }), 400, 'VALIDATION_FAILED');
    expectProblem(await foreign.owner.api.post(`${PATH}/test`), 400, 'VALIDATION_FAILED');
  });
  it('only owners may read, write or test; every other role and students are denied', async () => {
    for (const role of ['admin', 'teacher', 'cashier', 'gatekeeper'] as const) {
      expectProblem(await staff[role].api.get(PATH), 403, 'FORBIDDEN');
      expectProblem(
        await staff[role].api.patch(PATH, { merchantSecret: SECRET }),
        403,
        'FORBIDDEN',
      );
      expectProblem(await staff[role].api.post(`${PATH}/test`), 403, 'FORBIDDEN');
    }
    const student = api(t, tenant.host, await signInStudent(t, tenant, await f.student(tenant)));
    expectProblem(await student.get(PATH), 403, 'FORBIDDEN');
    expectProblem(await student.patch(PATH, { merchantSecret: SECRET }), 403, 'FORBIDDEN');
    expectProblem(await student.post(`${PATH}/test`), 403, 'FORBIDDEN');
    expectProblem(await api(t, tenant.host).get(PATH), 401, 'UNAUTHENTICATED');
  });
  it('isolates settings and refuses foreign cookies for all endpoints', async () => {
    const foreignOwner = await f.staff(other, ['owner']);
    const cookie = await signInStaff(t, other, foreignOwner);
    const foreign = api(t, other.host, cookie);
    expect((await foreign.get(PATH)).body.merchantId).toBeNull();
    await foreign.patch(PATH, { merchantId: '1234567' });
    expect((await staff.owner.api.get(PATH)).body.merchantId).toBe('1211234');
    const swapped = api(t, tenant.host, cookie);
    expectProblem(await swapped.get(PATH), 401, 'UNAUTHENTICATED');
    expectProblem(await swapped.patch(PATH, { merchantId: '8888' }), 401, 'UNAUTHENTICATED');
    expectProblem(await swapped.post(`${PATH}/test`), 401, 'UNAUTHENTICATED');
    expect(t.logs.text).not.toContain(SECRET);
  });
});
