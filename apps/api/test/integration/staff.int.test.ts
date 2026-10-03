import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@remix/db';
import {
  staffMemberSchema,
  staffResponseSchema,
  type StaffMember,
  type StaffRole,
} from '@remix/types/api';
import { PeopleHooks, type StaffInvitedEvent } from '../../src/modules/people/people-hooks';
import { smsTo } from './support/auth-helpers';
import { expectProblem } from '../fixtures/problem';
import {
  createDbTestApp,
  Factory,
  ownerDb,
  uniquePhone,
  type DbTestApp,
  type TenantFixture,
  type UserFixture,
} from './support/db-app';
import { api, signInStaff, signInStudent, staffByRole, type Api } from './support/people';

const STAFF = '/api/v1/admin/staff';
const INVITES = `${STAFF}/invites`;
const invitePath = (id: string) => `${INVITES}/${id}`;
const member = (id: string) => `${STAFF}/${id}`;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('admin staff (STF-01/02/03) against Postgres', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  let tenant: TenantFixture;
  let tutor: TenantFixture;
  let other: TenantFixture;
  let staff: Record<StaffRole, { user: UserFixture; api: Api }>;
  let classA: string;
  let foreignClass: string;
  const delivered: StaffInvitedEvent[] = [];

  const owner = () => staff.owner.api;
  const invite = (body: object, as: Api = owner()) => as.post(INVITES, body);
  const list = async (as: Api = owner()) =>
    staffResponseSchema.strict().parse((await as.get(STAFF)).body);

  beforeAll(async () => {
    t = await createDbTestApp();
    db = ownerDb();
    f = new Factory(db);
    tenant = await f.tenant('active');
    other = await f.tenant('active');
    tutor = await f.tenant('active');
    await db.update(schema.tenants).set({ plan: 'tutor' }).where(eq(schema.tenants.id, tutor.id));
    staff = await staffByRole(t, f, tenant);
    classA = await f.klass(tenant, { name: 'Physics Theory', feeCents: 1 });
    foreignClass = await f.klass(other, { name: 'Foreign', feeCents: 1 });
    t.app.get(PeopleHooks).registerStaffInvited((event) => {
      delivered.push(event);
    });
  });
  afterAll(async () => {
    await t.close();
    await db.$client.end();
  });

  describe('permissions — only owners manage staff', () => {
    it.each(['admin', 'teacher', 'cashier', 'gatekeeper'] as const)('%s gets 403', async (role) => {
      const who = staff[role].api;
      expectProblem(await who.get(STAFF), 403, 'FORBIDDEN');
      expectProblem(
        await invite({ displayName: 'X Y', phone: uniquePhone(), role: 'teacher' }, who),
        403,
        'FORBIDDEN',
      );
      expectProblem(
        await who.delete(invitePath('0197a8b0-0000-7000-8000-000000000000')),
        403,
        'FORBIDDEN',
      );
      expectProblem(
        await who.patch(member(staff.cashier.user.id), { status: 'disabled' }),
        403,
        'FORBIDDEN',
      );
    });

    it('students get 403 and anonymous callers 401', async () => {
      const student = await f.student(tenant);
      const as = api(t, tenant.host, await signInStudent(t, tenant, student));
      expectProblem(await as.get(STAFF), 403, 'FORBIDDEN');
      expectProblem(await api(t, tenant.host).get(STAFF), 401, 'UNAUTHENTICATED');
    });

    it('nothing changed after the refused calls', async () => {
      const users = await db
        .select()
        .from(schema.tenantUsers)
        .where(eq(schema.tenantUsers.id, staff.cashier.user.id));
      expect(users[0]?.status).toBe('active');
    });
  });

  describe('GET /admin/staff — STF-01, STF-03', () => {
    it('lists members with roles, scope, status and last sign-in, plus pending invites and usage', async () => {
      const body = await list();
      const owners = body.items.filter((m) => m.roles.includes('owner'));
      expect(owners).toHaveLength(1);
      expect(owners[0]).toMatchObject({ status: 'active', inviteExpiresAt: null });
      expect(owners[0]?.lastSignInAt).not.toBeNull();
      expect(body.items.map((m) => m.roles[0]).sort()).toEqual([
        'admin',
        'cashier',
        'gatekeeper',
        'owner',
        'teacher',
      ]);
      // Institute plan: unlimited teachers, 3 cashier logins; the cashier and teacher count.
      expect(body.usage).toEqual({
        teachers: { used: 1, limit: null },
        cashiers: { used: 1, limit: 3 },
      });
    });

    it('does not list other institutes, expired or revoked invitations', async () => {
      const foreign = await f.staff(other, ['owner'], { name: 'Foreign Owner' });
      expect((await list()).items.map((m) => m.id)).not.toContain(foreign.id);

      // Expired relative to the test clock (15 Oct 2026): created 20 days before, expired 17 days.
      const [expired] = await db
        .insert(schema.staffInvites)
        .values({
          tenantId: tenant.id,
          displayName: 'Expired Invite',
          phone: '+94770000501',
          role: 'teacher',
          tokenHash: sha256('expired'),
          invitedBy: staff.owner.user.id,
          createdAt: new Date('2026-09-25T00:00:00Z'),
          expiresAt: new Date('2026-09-28T00:00:00Z'),
        })
        .returning();
      const body = await list();
      expect(body.items.map((m) => m.id)).not.toContain(expired?.id);
      expect(body.usage.teachers.used).toBe(1);
      // Its phone is free again for a new invitation.
      expect(
        (await invite({ displayName: 'Again', phone: '+94770000501', role: 'gatekeeper' })).status,
      ).toBe(201);
    });
  });

  describe('POST /admin/staff/invites — STF-01', () => {
    it('stores only a hash, expires in 72 h, audits, and hands the raw token to the delivery hook', async () => {
      delivered.length = 0;
      const phone = uniquePhone();
      const res = await invite({
        displayName: 'Anura Kumara',
        phone,
        email: 'Anura@Example.test',
        role: 'teacher',
        classScope: [classA],
      });
      expect(res.status).toBe(201);
      const invited = staffMemberSchema.strict().parse(res.body);
      expect(invited).toMatchObject({
        displayName: 'Anura Kumara',
        roles: ['teacher'],
        classScope: [classA],
        status: 'invited',
        lastSignInAt: null,
        email: 'anura@example.test',
      });
      expect(new Date(invited.inviteExpiresAt ?? '').getTime()).toBe(
        t.clock.now().getTime() + 72 * 3_600_000,
      );

      expect(delivered).toHaveLength(1);
      const event = delivered[0];
      expect(event).toMatchObject({
        tenantId: tenant.id,
        inviteId: invited.id,
        role: 'teacher',
        phone,
      });
      expect(event?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      // Delivery is connected: the invitation link (token in the fragment) went out by SMS.
      const [sms] = await smsTo(t, phone);
      expect(sms?.text).toContain(`/admin/invite#${event?.token}`);

      const [row] = await db
        .select()
        .from(schema.staffInvites)
        .where(eq(schema.staffInvites.id, invited.id));
      expect(row?.tokenHash).toBe(sha256(event?.token ?? ''));
      expect(JSON.stringify(row)).not.toContain(event?.token);
      expect(row?.invitedBy).toBe(staff.owner.user.id);

      // The raw token is in no response body, header or audit row.
      expect(JSON.stringify(res.body) + JSON.stringify(res.headers)).not.toContain(event?.token);
      const audits = await f.audits(tenant, 'staff.invite');
      expect(JSON.stringify(audits)).not.toContain(event?.token);
      expect(JSON.stringify(audits)).not.toContain(phone);
      expect(audits.at(-1)).toMatchObject({ actorId: staff.owner.user.id, entityId: invited.id });

      const listed = (await list()).items.find((m) => m.id === invited.id);
      expect(listed).toMatchObject({ status: 'invited', roles: ['teacher'] });
    });

    it('needs a phone for SMS roles (400), and a phone or email for the others', async () => {
      expectProblem(
        await invite({ displayName: 'No Phone', email: 'x@example.test', role: 'cashier' }),
        400,
        'VALIDATION_FAILED',
      );
      expectProblem(
        await invite({ displayName: 'No Contact', role: 'gatekeeper' }),
        400,
        'VALIDATION_FAILED',
      );
      expect(
        (
          await invite({
            displayName: 'Gate Keeper',
            email: 'gate@example.test',
            role: 'gatekeeper',
          })
        ).status,
      ).toBe(201);
    });

    it('rejects contacts that are already used (409), also by pending invitations', async () => {
      expectProblem(
        await invite({ displayName: 'Dup', phone: staff.admin.user.phone, role: 'gatekeeper' }),
        409,
        'CONFLICT',
      );
      expectProblem(
        await invite({ displayName: 'Dup', email: staff.admin.user.email, role: 'gatekeeper' }),
        409,
        'CONFLICT',
      );
      const phone = uniquePhone();
      expect((await invite({ displayName: 'First', phone, role: 'gatekeeper' })).status).toBe(201);
      expectProblem(
        await invite({ displayName: 'Second', phone, role: 'gatekeeper' }),
        409,
        'CONFLICT',
      );
    });

    it('rejects classes of another institute (400) and ignores scope for non-teachers', async () => {
      expectProblem(
        await invite({
          displayName: 'Scoped',
          phone: uniquePhone(),
          role: 'teacher',
          classScope: [foreignClass],
        }),
        400,
        'VALIDATION_FAILED',
      );
      const res = await invite({
        displayName: 'Gate Scoped',
        phone: uniquePhone(),
        role: 'gatekeeper',
        classScope: [classA],
      });
      expect(res.body.classScope).toEqual([]);
    });

    it('enforces plan seats: Tutor allows 1 teacher and no cashier logins (403 PLAN_LIMIT)', async () => {
      const tutorOwner = await f.staff(tutor, ['owner', 'teacher']);
      const as = api(t, tutor.host, await signInStaff(t, tutor, tutorOwner));
      const teacher = await invite(
        { displayName: 'Second Teacher', phone: uniquePhone(), role: 'teacher' },
        as,
      );
      expectProblem(teacher, 403, 'PLAN_LIMIT');
      expectProblem(
        await invite({ displayName: 'Cashier', phone: uniquePhone(), role: 'cashier' }, as),
        403,
        'PLAN_LIMIT',
      );
      // Admins and gatekeepers are not seat-limited.
      expect(
        (await invite({ displayName: 'Admin', phone: uniquePhone(), role: 'admin' }, as)).status,
      ).toBe(201);
      const usage = (await list(as)).usage;
      expect(usage).toEqual({ teachers: { used: 1, limit: 1 }, cashiers: { used: 0, limit: 0 } });
    });

    it('counts pending invitations as seats and frees them on revoke', async () => {
      const inst = await f.tenant('active');
      const o = await f.staff(inst, ['owner']);
      const as = api(t, inst.host, await signInStaff(t, inst, o));
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await invite(
          { displayName: `Cashier ${i}`, phone: uniquePhone(), role: 'cashier' },
          as,
        );
        expect(res.status).toBe(201);
        ids.push(res.body.id as string);
      }
      expectProblem(
        await invite({ displayName: 'Cashier 4', phone: uniquePhone(), role: 'cashier' }, as),
        403,
        'PLAN_LIMIT',
      );
      expect((await as.delete(invitePath(ids[0] ?? ''))).status).toBe(204);
      expect(
        (await invite({ displayName: 'Cashier 4', phone: uniquePhone(), role: 'cashier' }, as))
          .status,
      ).toBe(201);
    });
  });

  describe('DELETE /admin/staff/invites/:id — STF-01', () => {
    it('revokes, is idempotent, audits and removes the invite from the list', async () => {
      const res = await invite({
        displayName: 'Revoke Me',
        phone: uniquePhone(),
        role: 'gatekeeper',
      });
      const id = res.body.id as string;
      const first = await owner().delete(invitePath(id));
      expect(first.status).toBe(204);
      expect(first.text).toBe('');
      expect((await owner().delete(invitePath(id))).status).toBe(204);
      expect((await list()).items.map((m) => m.id)).not.toContain(id);
      const [row] = await db
        .select()
        .from(schema.staffInvites)
        .where(eq(schema.staffInvites.id, id));
      expect(row?.revokedAt).not.toBeNull();
      const audits = (await f.audits(tenant, 'staff.invite_revoke')).filter(
        (a) => a.entityId === id,
      );
      expect(audits).toHaveLength(1);
    });

    it('404s for unknown and foreign invitations, 409s for accepted ones', async () => {
      const foreignOwner = await f.staff(other, ['owner']);
      const foreignApi = api(t, other.host, await signInStaff(t, other, foreignOwner));
      const res = await invite(
        { displayName: 'Foreign Invite', phone: uniquePhone(), role: 'gatekeeper' },
        foreignApi,
      );
      expectProblem(await owner().delete(invitePath(res.body.id as string)), 404, 'NOT_FOUND');
      const [row] = await db
        .select()
        .from(schema.staffInvites)
        .where(eq(schema.staffInvites.id, res.body.id as string));
      expect(row?.revokedAt).toBeNull();

      const mine = await invite({
        displayName: 'Accepted',
        phone: uniquePhone(),
        role: 'gatekeeper',
      });
      await db
        .update(schema.staffInvites)
        .set({ acceptedAt: new Date(), acceptedUserId: staff.admin.user.id })
        .where(eq(schema.staffInvites.id, mine.body.id as string));
      expectProblem(await owner().delete(invitePath(mine.body.id as string)), 409, 'CONFLICT');
    });
  });

  describe('PATCH /admin/staff/:id — STF-02, STF-01', () => {
    it('changes a role and audits before and after', async () => {
      const user = await f.staff(tenant, ['gatekeeper'], { name: 'Role Change' });
      const res = await owner().patch(member(user.id), { role: 'admin' });
      expect(res.status).toBe(200);
      expect(staffMemberSchema.strict().parse(res.body)).toMatchObject({
        roles: ['admin'],
        status: 'active',
      });
      const audits = (await f.audits(tenant, 'staff.role_change')).filter(
        (a) => a.entityId === user.id,
      );
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actorId: staff.owner.user.id,
        before: { roles: ['gatekeeper'] },
        after: { roles: ['admin'] },
      });
    });

    it('sets the class scope of a teacher, validates classes, refuses scope for others', async () => {
      const teacher = await f.staff(tenant, ['teacher']);
      const res = await owner().patch(member(teacher.id), { classScope: [classA] });
      expect(res.body).toMatchObject({ roles: ['teacher'], classScope: [classA] });
      expect(await f.audits(tenant, 'staff.scope_change')).toHaveLength(1);
      expectProblem(
        await owner().patch(member(teacher.id), { classScope: [foreignClass] }),
        400,
        'VALIDATION_FAILED',
      );
      const cashier = await f.staff(tenant, ['cashier']);
      expectProblem(
        await owner().patch(member(cashier.id), { classScope: [classA] }),
        400,
        'VALIDATION_FAILED',
      );
      // Changing role and scope together.
      const both = await owner().patch(member(cashier.id), {
        role: 'teacher',
        classScope: [classA],
      });
      expect(both.body).toMatchObject({ roles: ['teacher'], classScope: [classA] });
    });

    it('a scope change takes effect on the next request (teacher sees only that class)', async () => {
      const teacher = await f.staff(tenant, ['teacher']);
      const as = api(t, tenant.host, await signInStaff(t, tenant, teacher));
      const student = await f.student(tenant, { name: 'Scope Student' });
      await f.enroll(tenant, student.id, classA, { from: '2026-01-01' });
      expect((await as.get('/api/v1/admin/students?q=Scope')).body.items).toEqual([]);
      await owner().patch(member(teacher.id), { classScope: [classA] });
      expect((await as.get('/api/v1/admin/students?q=Scope')).body.items).toHaveLength(1);
    });

    it('disabling ends sessions at once, blocks login, audits; enabling restores', async () => {
      const user = await f.staff(tenant, ['cashier'], { name: 'To Disable' });
      const cookie = await signInStaff(t, tenant, user);
      const as = api(t, tenant.host, cookie);
      expect((await as.get('/api/v1/auth/session')).status).toBe(200);

      const res = await owner().patch(member(user.id), { status: 'disabled' });
      expect(res.body.status).toBe('disabled');
      expect((await as.get('/api/v1/auth/session')).status).toBe(401);
      for (const s of await f.sessionsOf(user)) expect(s.revokedAt).not.toBeNull();
      expect(
        (await f.audits(tenant, 'staff.disable')).filter((a) => a.entityId === user.id),
      ).toHaveLength(1);
      expect((await list()).items.find((m) => m.id === user.id)?.status).toBe('disabled');

      const back = await owner().patch(member(user.id), { status: 'active' });
      expect(back.body.status).toBe('active');
      expect(
        (await f.audits(tenant, 'staff.enable')).filter((a) => a.entityId === user.id),
      ).toHaveLength(1);
      expect((await signInStaff(t, tenant, user)).length).toBeGreaterThan(0);
    });

    it('the last active owner can never be demoted or disabled', async () => {
      const inst = await f.tenant('active');
      const sole = await f.staff(inst, ['owner']);
      const as = api(t, inst.host, await signInStaff(t, inst, sole));
      expectProblem(await as.patch(member(sole.id), { role: 'admin' }), 409, 'CONFLICT');
      expectProblem(await as.patch(member(sole.id), { status: 'disabled' }), 409, 'CONFLICT');
      expect((await as.get(STAFF)).body.items[0].roles).toEqual(['owner']);

      // With a second active owner, one of them can step down.
      const second = await f.staff(inst, ['owner']);
      expect((await as.patch(member(second.id), { role: 'admin' })).status).toBe(200);
      // ... but then the remaining one is the last again.
      expectProblem(await as.patch(member(sole.id), { status: 'disabled' }), 409, 'CONFLICT');
      // A disabled owner does not count as an owner.
      const third = await f.staff(inst, ['owner']);
      expect((await as.patch(member(third.id), { status: 'disabled' })).status).toBe(200);
      expectProblem(await as.patch(member(sole.id), { role: 'teacher' }), 409, 'CONFLICT');
    });

    it('re-checks plan seats when a change newly occupies one', async () => {
      const tutorOwner = await f.staff(tutor, ['owner', 'teacher']);
      const as = api(t, tutor.host, await signInStaff(t, tutor, tutorOwner));
      const admin = await f.staff(tutor, ['admin']);
      expectProblem(await as.patch(member(admin.id), { role: 'teacher' }), 403, 'PLAN_LIMIT');
      expectProblem(await as.patch(member(admin.id), { role: 'cashier' }), 403, 'PLAN_LIMIT');
      expect((await as.patch(member(admin.id), { role: 'gatekeeper' })).status).toBe(200);
      // An unrelated edit of someone already holding the seat is fine.
      expect((await as.patch(member(tutorOwner.id), { classScope: [] })).status).toBe(200);
    });

    it('rejects empty bodies, unknown ids, students and foreign staff', async () => {
      expectProblem(await owner().patch(member(staff.admin.user.id), {}), 400, 'VALIDATION_FAILED');
      expectProblem(
        await owner().patch(member('0197a8b0-0000-7000-8000-000000000000'), { role: 'admin' }),
        404,
        'NOT_FOUND',
      );
      const student = await f.student(tenant);
      expectProblem(
        await owner().patch(member(student.id), { status: 'disabled' }),
        404,
        'NOT_FOUND',
      );
      const foreign = await f.staff(other, ['cashier']);
      expectProblem(
        await owner().patch(member(foreign.id), { status: 'disabled' }),
        404,
        'NOT_FOUND',
      );
      const [row] = await db
        .select()
        .from(schema.tenantUsers)
        .where(eq(schema.tenantUsers.id, foreign.id));
      expect(row?.status).toBe('active');
    });

    it('cannot enable a person who never set a password', async () => {
      const user = await f.staff(tenant, ['gatekeeper']);
      await db
        .update(schema.tenantUsers)
        .set({ status: 'disabled', passwordHash: null })
        .where(eq(schema.tenantUsers.id, user.id));
      expectProblem(await owner().patch(member(user.id), { status: 'active' }), 409, 'CONFLICT');
    });
  });

  it('a hook that throws never fails the invitation', async () => {
    t.app.get(PeopleHooks).registerStaffInvited(() => {
      throw new Error('queue down');
    });
    const res = await invite({
      displayName: 'Resilient',
      phone: uniquePhone(),
      role: 'gatekeeper',
    });
    expect(res.status).toBe(201);
    const listed: StaffMember | undefined = (await list()).items.find((m) => m.id === res.body.id);
    expect(listed?.status).toBe('invited');
  });
});
