import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { resolveTenantByHost } from '../src/resolve';
import { seed } from '../src/seed';
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
