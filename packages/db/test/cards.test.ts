import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/tenant';
import { connectAll, expectPgError, rolledBack, Rollback } from './support';
import { createWorld, type World } from './tables';

const db = connectAll();
let a: World; let b: World;
beforeAll(async () => { [a, b] = await Promise.all([createWorld(db.owner, 'cards-a'), createWorld(db.owner, 'cards-b')]); });
describe('STU-06 card constraints and immutable credentials', () => {
  it('lifecycle updates are tenant bound; identities and credentials cannot change or be deleted', async () => {
    await rolledBack(withTenant(db.app, a.tenantId, async tx => {
      expect((await tx.execute(sql`update student_cards set status = status where id = ${b.cardId}::uuid`)).rowCount).toBe(0);
      expect((await tx.execute(sql`update student_cards set status = 'revoked', revoked_at = now(), revoked_by = ${a.staffUserId}::uuid, revoke_reason = 'Lost' where id = ${a.cardId}::uuid`)).rowCount).toBe(1);
      throw new Rollback();
    }));
    for (const column of ['id', 'tenant_id', 'student_id', 'code', 'format', 'source', 'issued_at', 'issued_by']) {
      await expectPgError(withTenant(db.app, a.tenantId, tx => tx.execute(sql`update student_cards set ${sql.identifier(column)} = ${sql.identifier(column)}`)), '42501');
    }
    await expectPgError(withTenant(db.app, a.tenantId, tx => tx.execute(sql`delete from student_cards`)), '42501');
  });
  it('reserves revoked codes forever and permits only one active card per student', async () => {
    const insert = (code: string) => withTenant(db.app, a.tenantId, tx => tx.execute(sql`insert into student_cards (tenant_id, student_id, code, format, source, issued_by) values (${a.tenantId}, ${a.studentUserId}, ${code}, 'qr', 'linked', ${a.staffUserId})`));
    await expectPgError(insert('ANOTHERCARD'), '23505');
    await withTenant(db.app, a.tenantId, tx => tx.execute(sql`update student_cards set status = 'revoked', revoked_at = now(), revoked_by = ${a.staffUserId}::uuid, revoke_reason = 'Lost' where id = ${a.cardId}::uuid`));
    await expectPgError(insert('ISOLATIONCARD'), '23505');
    await insert('ANOTHERCARD');
  });
  it('rejects noncanonical codes and incomplete revocation fields', async () => {
    for (const code of ['abc', 'AB:CD', 'A'.repeat(65)]) {
      await expectPgError(withTenant(db.app, b.tenantId, tx => tx.execute(sql`insert into student_cards (tenant_id, student_id, code, format, source, issued_by) values (${b.tenantId}, ${b.studentUserId}, ${code}, 'qr', 'linked', ${b.staffUserId})`)), '23514');
    }
    await expectPgError(withTenant(db.app, b.tenantId, tx => tx.execute(sql`update student_cards set status = 'revoked'`)), '23514');
    await expectPgError(withTenant(db.app, b.tenantId, tx => tx.execute(sql`update student_cards set revoked_at = now()`)), '23514');
  });
});
