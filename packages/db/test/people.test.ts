import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/tenant';
import { connectAll, expectPgError, rows } from './support';
import { createWorld, type World } from './tables';

/** Constraints of the people tables (guardians, consent columns, staff_invites). */
const db = connectAll();
let w: World;

beforeAll(async () => {
  w = await createWorld(db.owner, 'people');
});

const PG_CHECK = '23514';
const PG_UNIQUE = '23505';

describe('PAR-03 consent', () => {
  it('rejects under18 without recorded consent', async () => {
    await expectPgError(
      db.owner.execute(sql`update students set under18 = true where user_id = ${w.studentUserId}`),
      PG_CHECK,
      /students_under18_has_consent/,
    );
  });

  it('accepts under18 with consent, and rejects an unknown consent method', async () => {
    await db.owner.execute(sql`
      update students set under18 = true, consent_given_by = 'Mother',
        consent_method = 'paper_form', consent_recorded_at = now()
      where user_id = ${w.studentUserId}`);
    await expectPgError(
      db.owner.execute(
        sql`update students set consent_method = 'telepathy' where user_id = ${w.studentUserId}`,
      ),
      '22P02',
    );
  });
});

describe('PAR-01 guardians', () => {
  it('allows one row per student and phone', async () => {
    const insert = () =>
      db.owner.execute(sql`
        insert into guardians (tenant_id, student_id, name, relation, phone)
        values (${w.tenantId}, ${w.studentUserId}, 'Parent', 'mother', '+94770000044')`);
    await insert();
    await expectPgError(insert(), PG_UNIQUE, /guardians_tenant_student_phone_key/);
  });

  it('rejects a malformed phone', async () => {
    await expectPgError(
      db.owner.execute(sql`
        insert into guardians (tenant_id, student_id, name, relation, phone)
        values (${w.tenantId}, ${w.studentUserId}, 'Parent', 'mother', '0771234567')`),
      PG_CHECK,
      /guardians_phone_e164/,
    );
  });

  it('are deleted with their student', async () => {
    const other = await createWorld(db.owner, 'cascade');
    await db.owner.execute(sql`delete from enrollments where student_id = ${other.studentUserId}`);
    await db.owner.execute(sql`delete from students where user_id = ${other.studentUserId}`);
    const left = await withTenant(db.app, other.tenantId, (tx) =>
      rows(tx, sql`select 1 from guardians`),
    );
    expect(left).toEqual([]);
  });
});

describe('STF-01 staff_invites', () => {
  it('needs a phone or an email', async () => {
    await expectPgError(
      db.owner.execute(sql`
        insert into staff_invites (tenant_id, display_name, role, token_hash, invited_by, expires_at)
        values (${w.tenantId}, 'X', 'teacher', ${'1'.repeat(64)}, ${w.staffUserId}, now() + interval '72 hours')`),
      PG_CHECK,
      /staff_invites_has_contact/,
    );
  });

  it('token hash is unique per tenant', async () => {
    await expectPgError(
      db.owner.execute(sql`
        insert into staff_invites (tenant_id, display_name, phone, role, token_hash, invited_by, expires_at)
        values (${w.tenantId}, 'X', '+94770000033', 'teacher', ${'e'.repeat(64)}, ${w.staffUserId}, now() + interval '72 hours')`),
      PG_UNIQUE,
      /staff_invites_tenant_token_hash_key/,
    );
  });

  it('an accepted invite names the user who accepted it', async () => {
    await expectPgError(
      db.owner.execute(
        sql`update staff_invites set accepted_at = now() where id = ${w.staffInviteId}`,
      ),
      PG_CHECK,
      /staff_invites_accepted_has_user/,
    );
  });
});
