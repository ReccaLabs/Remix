import { verify } from '@node-rs/argon2';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { createTenant, defaultPrefix } from '../src/provision';
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
    expect(defaultPrefix('Kamal Physics')).toBe('KP');
    expect(defaultPrefix('  royal   science classes ')).toBe('RSC');
    expect(defaultPrefix('ශ්‍රී')).toBe('ST');
  });
});
