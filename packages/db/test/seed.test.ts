import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { resolveTenantByHost } from '../src/resolve';
import { devTrustToken, seed } from '../src/seed';
import { withTenant } from '../src/tenant';
import { connectAll, rows } from './support';

const db = connectAll();

/** Digest of everything the seed decides (not ids, timestamps or password hashes). */
const contentDigest = sql`
  select md5(string_agg(line, E'\\n' order by line)) as digest, count(*)::int as lines from (
    select concat_ws('|', t.slug, t.status, t.plan, t.student_no_prefix) as line
      from tenants t where t.slug in ('kamalphysics', 'royalscience', 'closedacademy')
    union all
    select concat_ws('|', t.slug, u.kind, u.phone, u.email, u.display_name, u.status, u.locale,
        s.student_no, s.school, s.al_year, s.medium)
      from tenant_users u join tenants t on t.id = u.tenant_id
      left join students s on s.user_id = u.id
      where t.slug in ('kamalphysics', 'royalscience', 'closedacademy')
    union all
    select concat_ws('|', t.slug, s.student_no, c.name, e.from_month, e.fee_override_cents, e.reason)
      from enrollments e join tenants t on t.id = e.tenant_id
      join students s on s.user_id = e.student_id join classes c on c.id = e.class_id
      where t.slug in ('kamalphysics', 'royalscience', 'closedacademy')
  ) lines
`;

describe('dev seed', () => {
  it('is deterministic and idempotent (reset-first)', async () => {
    const first = await seed(db.owner, 'seed-test-hash');
    const digest1 = await rows<{ digest: string; lines: number }>(db.owner, contentDigest);
    const second = await seed(db.owner, 'seed-test-hash');
    const digest2 = await rows<{ digest: string; lines: number }>(db.owner, contentDigest);

    expect(digest2).toEqual(digest1);
    expect(second.map(({ tenantId: _id, ...rest }) => rest)).toEqual(
      first.map(({ tenantId: _id, ...rest }) => rest),
    );
    expect(first.map((s) => [s.slug, s.students, s.classes, s.staff])).toEqual([
      ['kamalphysics', 2000, 6, 4],
      ['royalscience', 40, 2, 1],
      ['closedacademy', 5, 1, 1],
    ]);
  }, 120_000);

  it('produces the sample people the designs show, numbered from the tenant counter', async () => {
    const kamal = await resolveTenantByHost(db.app, 'kamalphysics.localhost', {
      baseDomains: ['localhost'],
    });
    expect(kamal).toMatchObject({ slug: 'kamalphysics', status: 'active', plan: 'institute' });
    if (!kamal) return;

    const nimali = await withTenant(db.app, kamal.id, (tx) =>
      rows<{ display_name: string; phone: string; classes: number }>(
        tx,
        sql`select u.display_name, u.phone, (select count(*)::int from enrollments e
              where e.student_id = s.user_id) as classes
            from students s join tenant_users u on u.id = s.user_id
            where s.student_no = 'BR-1042'`,
      ),
    );
    expect(nimali).toEqual([
      { display_name: 'Nimali Perera', phone: '+94710001042', classes: expect.any(Number) },
    ]);
    expect(nimali[0]?.classes).toBeGreaterThan(0);

    const counter = await withTenant(db.app, kamal.id, (tx) =>
      rows<{ value: number }>(
        tx,
        sql`select value::int from tenant_counters where kind = 'student'`,
      ),
    );
    expect(counter).toEqual([{ value: 2800 }]);
  });

  it('gives two-step staff (owner/admin/cashier) a trusted dev computer; teachers none', async () => {
    const trusted = await rows<{ phone: string; trust_token_hash: string }>(
      db.owner,
      sql`select u.phone, d.trust_token_hash from devices d
          join tenant_users u on u.id = d.user_id join tenants t on t.id = d.tenant_id
          where t.slug = 'kamalphysics' and d.trust_token_hash is not null
            and d.trusted_until > now() order by u.phone`,
    );
    expect(trusted.map((r) => r.phone)).toEqual(['+94770001180', '+94770001181', '+94770001182']);
    const expected = createHash('sha256')
      .update(devTrustToken('kamalphysics', '+94770001180'))
      .digest('hex');
    expect(trusted[0]?.trust_token_hash).toBe(expected);
  });

  it('seeds people data: invited students, guardians, minors with consent, a scoped teacher, a pending invite', async () => {
    const kamal = await resolveTenantByHost(db.app, 'kamalphysics.localhost', {
      baseDomains: ['localhost'],
    });
    if (!kamal) throw new Error('kamalphysics missing');
    const [counts] = await withTenant(db.app, kamal.id, (tx) =>
      rows<{
        invited: number;
        no_password: number;
        guardians: number;
        minors: number;
        bad_minors: number;
        scoped: number;
        invites: number;
      }>(
        tx,
        sql`select
          (select count(*)::int from tenant_users where status = 'invited') as invited,
          (select count(*)::int from tenant_users where status = 'invited' and password_hash is null) as no_password,
          (select count(*)::int from guardians) as guardians,
          (select count(*)::int from students where under18) as minors,
          (select count(*)::int from students where under18 and consent_method is null) as bad_minors,
          (select count(*)::int from staff_roles where role = 'teacher' and class_scope is not null) as scoped,
          (select count(*)::int from staff_invites where accepted_at is null and revoked_at is null) as invites`,
      ),
    );
    expect(counts).toMatchObject({
      invited: 6,
      no_password: 6,
      bad_minors: 0,
      scoped: 1,
      invites: 1,
    });
    expect(counts?.guardians).toBeGreaterThanOrEqual(2000);
    expect(counts?.minors).toBeGreaterThan(0);
  });

  it('seeds a verified and an unverified custom domain, and a suspended tenant', async () => {
    const opts = { baseDomains: ['localhost'] };
    expect((await resolveTenantByHost(db.app, 'kamalphysics.test', opts))?.slug).toBe(
      'kamalphysics',
    );
    expect(await resolveTenantByHost(db.app, 'pending.kamalphysics.test', opts)).toBeNull();
    expect((await resolveTenantByHost(db.app, 'closedacademy.localhost', opts))?.status).toBe(
      'suspended',
    );
  });
});
