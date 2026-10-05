import { randomUUID } from 'node:crypto';
import { verify } from '@node-rs/argon2';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { hashPassword } from '../src/password';
import { createTenant, defaultPrefix, OwnerResetError, resetOwnerPassword } from '../src/provision';
import { auditLogs, sessions, staffRoles, tenants, tenantUsers } from '../src/schema';
import { withTenant } from '../src/tenant';
import { connectAll, expectPgError, rows, uniqueTag } from './support';

const db = connectAll();

describe('createTenant (tenant:create CLI)', () => {
  it('creates a trial tenant with an owner whose temporary password must be changed', async () => {
    const slug = `cli-${uniqueTag()}`;
    const created = await createTenant(db.owner, {
      slug,
      name: 'Galle Maths Centre',
      plan: 'tutor',
      ownerPhone: '077 123 4567',
      ownerName: 'Chathura Mendis',
    });
    expect(created.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{24}$/);

    const owner = await withTenant(db.app, created.tenantId, (tx) =>
      rows<{
        phone: string;
        password_hash: string;
        must_change_password: boolean;
        roles: string[];
        prefix: string;
        status: string;
        audit: number;
      }>(
        tx,
        sql`select u.phone, u.password_hash, u.must_change_password,
              array(select r.role::text from staff_roles r where r.user_id = u.id) as roles,
              t.student_no_prefix as prefix, t.status::text as status,
              (select count(*)::int from audit_logs a where a.action = 'tenant.create') as audit
            from tenant_users u join tenants t on t.id = u.tenant_id
            where u.id = ${created.ownerUserId}`,
      ),
    );
    expect(owner).toHaveLength(1);
    const row = owner[0];
    expect(row).toMatchObject({
      phone: '+94771234567',
      must_change_password: true,
      roles: ['owner'],
      prefix: 'GMC',
      status: 'trial',
      audit: 1,
    });
    expect(row?.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verify(row?.password_hash ?? '', created.temporaryPassword)).toBe(true);
  });

  it('rejects reserved or malformed slugs and bad phones before touching the database', async () => {
    const base = {
      name: 'X Academy',
      plan: 'tutor',
      ownerPhone: '0771234567',
      ownerName: 'X',
    } as const;
    for (const slug of ['admin', 'www', 'Bad Slug', 'a--b', 'ab']) {
      await expect(createTenant(db.owner, { ...base, slug })).rejects.toBeInstanceOf(ZodError);
    }
    await expect(
      createTenant(db.owner, { ...base, slug: `ok-${uniqueTag()}`, ownerPhone: '0112345678' }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('refuses a duplicate slug', async () => {
    const slug = `dup-${uniqueTag()}`;
    const input = {
      slug,
      name: 'Dup Classes',
      plan: 'tutor',
      ownerPhone: '0771234567',
      ownerName: 'D',
    } as const;
    await createTenant(db.owner, input);
    await expectPgError(createTenant(db.owner, input), '23505');
  });

  it('derives the student-number prefix from the name', () => {
    expect(defaultPrefix('Kamal Physics')).toBe('KPA');
    expect(defaultPrefix('  royal   science classes ')).toBe('RSC');
    expect(defaultPrefix('ශ්‍රී')).toBe('ST');
  });
  it('reserves globally unique prefixes under concurrent provisioning and rejects explicit reuse', async () => {
    const input = {
      name: 'Nilanka Institute',
      plan: 'institute',
      ownerPhone: '0771234567',
      ownerName: 'Owner',
    } as const;
    const created = await Promise.all(
      Array.from({ length: 3 }, () =>
        createTenant(db.owner, { ...input, slug: `prefix-${uniqueTag()}` }),
      ),
    );
    const prefixes = await db.owner.select({ prefix: tenants.studentNoPrefix }).from(tenants);
    expect(prefixes.map((p) => p.prefix)).toEqual(expect.arrayContaining(['NIL', 'NILA', 'NLI']));
    expect(new Set(prefixes.map((p) => p.prefix)).size).toBe(prefixes.length);
    await expectPgError(
      createTenant(db.owner, { ...input, slug: `prefix-${uniqueTag()}`, studentNoPrefix: 'NIL' }),
      '23505',
    );
    expect(created).toHaveLength(3);
  });
});

describe('resetOwnerPassword (tenant:reset-owner-password CLI, S-05)', () => {
  const create = (tag: string, phone = '0771234567') =>
    createTenant(db.owner, {
      slug: `rst-${tag}`,
      name: 'Reset Classes',
      plan: 'tutor',
      ownerPhone: phone,
      ownerName: 'Owner One',
    });

  const addSession = async (tenantId: string, userId: string) => {
    const [row] = await db.owner
      .insert(sessions)
      .values({
        tenantId,
        userId,
        tokenHash: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
        familyId: randomUUID(),
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning({ id: sessions.id });
    if (!row) throw new Error('session not created');
    return row.id;
  };

  const sessionState = async (id: string) => {
    const [row] = await db.owner
      .select({ revokedAt: sessions.revokedAt, reason: sessions.revokedReason })
      .from(sessions)
      .where(eq(sessions.id, id));
    return row;
  };

  it('sets a new temporary password, flags it for change and revokes the owner sessions', async () => {
    const created = await create(uniqueTag());
    // Simulate an owner who "changed" it (flag cleared) and is signed in on two devices.
    await db.owner
      .update(tenantUsers)
      .set({ mustChangePassword: false })
      .where(eq(tenantUsers.id, created.ownerUserId));
    const a = await addSession(created.tenantId, created.ownerUserId);
    const b = await addSession(created.tenantId, created.ownerUserId);

    const reset = await resetOwnerPassword(db.owner, { slug: created.slug });
    expect(reset).toMatchObject({
      tenantId: created.tenantId,
      ownerUserId: created.ownerUserId,
      revokedSessions: 2,
    });
    expect(reset.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(reset.temporaryPassword).not.toBe(created.temporaryPassword);

    const [user] = await db.owner
      .select({ hash: tenantUsers.passwordHash, must: tenantUsers.mustChangePassword })
      .from(tenantUsers)
      .where(eq(tenantUsers.id, created.ownerUserId));
    expect(user?.must).toBe(true);
    expect(user?.hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verify(user?.hash ?? '', reset.temporaryPassword)).toBe(true);
    expect(await verify(user?.hash ?? '', created.temporaryPassword)).toBe(false);

    for (const id of [a, b]) {
      expect(await sessionState(id)).toMatchObject({ reason: 'password_reset' });
      expect((await sessionState(id))?.revokedAt).toBeInstanceOf(Date);
    }
  });

  it('writes an audit row without any secret', async () => {
    const created = await create(uniqueTag());
    const reset = await resetOwnerPassword(db.owner, { slug: created.slug });
    const audit = await db.owner
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.tenantId, created.tenantId));
    const row = audit.find((r) => r.action === 'user.password_reset');
    expect(row).toMatchObject({
      actorKind: 'system',
      entity: 'user',
      entityId: created.ownerUserId,
      after: { via: 'cli', mustChangePassword: true, revokedSessions: 0 },
    });
    const text = JSON.stringify(row);
    expect(text).not.toContain(reset.temporaryPassword);
    expect(text).not.toContain('argon2');
  });

  it('touches nobody else: other users, already revoked sessions and other tenants', async () => {
    const mine = await create(uniqueTag());
    const other = await create(uniqueTag(), '0772222222');
    const [colleague] = await db.owner
      .insert(tenantUsers)
      .values({
        tenantId: mine.tenantId,
        kind: 'staff',
        phone: '+94773333333',
        displayName: 'Cashier',
        passwordHash: await hashPassword('cashier-password'),
      })
      .returning({ id: tenantUsers.id });
    if (!colleague) throw new Error('user not created');

    const colleagueSession = await addSession(mine.tenantId, colleague.id);
    const otherOwnerSession = await addSession(other.tenantId, other.ownerUserId);
    const earlier = new Date('2026-01-01T00:00:00Z');
    const alreadyRevoked = await addSession(mine.tenantId, mine.ownerUserId);
    await db.owner
      .update(sessions)
      .set({ revokedAt: earlier, revokedReason: 'logout' })
      .where(eq(sessions.id, alreadyRevoked));

    const reset = await resetOwnerPassword(db.owner, { slug: mine.slug });
    expect(reset.revokedSessions).toBe(0);
    expect((await sessionState(colleagueSession))?.revokedAt).toBeNull();
    expect((await sessionState(otherOwnerSession))?.revokedAt).toBeNull();
    expect(await sessionState(alreadyRevoked)).toEqual({ revokedAt: earlier, reason: 'logout' });

    const [untouched] = await db.owner
      .select({ hash: tenantUsers.passwordHash })
      .from(tenantUsers)
      .where(eq(tenantUsers.id, other.ownerUserId));
    expect(await verify(untouched?.hash ?? '', other.temporaryPassword)).toBe(true);
  });

  it('fails clearly for an unknown tenant, a tenant without an owner and bad input', async () => {
    await expect(
      resetOwnerPassword(db.owner, { slug: `nope-${uniqueTag()}` }),
    ).rejects.toMatchObject({ reason: 'tenant_not_found' });

    const slug = `noo-${uniqueTag()}`;
    await db.owner
      .insert(tenants)
      .values({ slug, name: 'No Owner', plan: 'tutor', studentNoPrefix: 'NO' });
    await expect(resetOwnerPassword(db.owner, { slug })).rejects.toBeInstanceOf(OwnerResetError);
    await expect(resetOwnerPassword(db.owner, { slug })).rejects.toMatchObject({
      reason: 'no_owner',
    });

    await expect(resetOwnerPassword(db.owner, { slug: 'Bad Slug' })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(
      resetOwnerPassword(db.owner, { slug, ownerPhone: '0112345678' }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('with several owners it needs --owner-phone to pick one', async () => {
    const created = await create(uniqueTag());
    const [second] = await db.owner
      .insert(tenantUsers)
      .values({
        tenantId: created.tenantId,
        kind: 'staff',
        phone: '+94774444444',
        displayName: 'Owner Two',
        passwordHash: await hashPassword('owner-two-password'),
      })
      .returning({ id: tenantUsers.id });
    if (!second) throw new Error('user not created');
    await db.owner
      .insert(staffRoles)
      .values({ tenantId: created.tenantId, userId: second.id, role: 'owner' });

    await expect(resetOwnerPassword(db.owner, { slug: created.slug })).rejects.toMatchObject({
      reason: 'ambiguous_owner',
    });
    const reset = await resetOwnerPassword(db.owner, {
      slug: created.slug,
      ownerPhone: '077 444 4444',
    });
    expect(reset.ownerUserId).toBe(second.id);
  });
});
