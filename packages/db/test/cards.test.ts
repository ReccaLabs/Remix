import { getTableColumns, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { studentCards } from '../src/schema';
import { withTenant } from '../src/tenant';
import { connectAll, expectPgError, rolledBack, Rollback } from './support';
import { createWorld, type World } from './tables';

const db = connectAll();
let a: World;
let b: World;
beforeAll(async () => {
  [a, b] = await Promise.all([createWorld(db.owner, 'cards-a'), createWorld(db.owner, 'cards-b')]);
});
const insert = (world: World, changes: Partial<typeof studentCards.$inferInsert> = {}) => withTenant(db.app, world.tenantId, tx => {
  const values = { tenantId: world.tenantId, studentId: world.studentUserId, cardSeq: 2, code: 'IS-0001-2', kind: 'permanent', formats: ['barcode'], status: 'ordered', issuedBy: world.staffUserId, ...changes };
  const columns = getTableColumns(studentCards);
  const entries = Object.entries(values) as [keyof typeof columns, unknown][];
  return tx.execute(sql`insert into student_cards (${sql.join(entries.map(([key]) => sql.identifier(columns[key].name)), sql`, `)}) values (${sql.join(entries.map(([,value]) => sql`${sql.param(value)}`), sql`, `)})`);
});

describe('STU-06 card lifecycle constraints and reserved identities', () => {
  it('binds lifecycle updates to the tenant and forbids identity changes and deletion', async () => {
    await rolledBack(
      withTenant(db.app, a.tenantId, async (tx) => {
        expect(
          (
            await tx.execute(
              sql`update student_cards set status = status where id = ${b.cardId}::uuid`,
            )
          ).rowCount,
        ).toBe(0);
        expect(
          (
            await tx.execute(
              sql`update student_cards set status = 'revoked', revoked_at = now(), revoked_by = ${a.staffUserId}::uuid, revoke_reason = 'Lost' where id = ${a.cardId}::uuid`,
            )
          ).rowCount,
        ).toBe(1);
        throw new Rollback();
      }),
    );
    for (const column of [
      'id',
      'tenant_id',
      'student_id',
      'card_seq',
      'code',
      'kind',
      'formats',
      'issued_at',
      'issued_by',
    ]) {
      await expectPgError(
        withTenant(db.app, a.tenantId, (tx) =>
          tx.execute(
            sql`update student_cards set ${sql.identifier(column)} = ${sql.identifier(column)}`,
          ),
        ),
        '42501',
      );
    }
    await expectPgError(
      withTenant(db.app, a.tenantId, (tx) => tx.execute(sql`delete from student_cards`)),
      '42501',
    );
  });
  it('permits only one active and one ordered card, retaining sequences and codes after revocation', async () => {
    await expectPgError(
      insert(a, { status: 'active', activatedAt: new Date(), activatedBy: a.staffUserId }),
      '23505',
    );
    await insert(a);
    await expectPgError(insert(a, { cardSeq: 3, code: 'IS-0001-3' }), '23505');
    await withTenant(db.app, a.tenantId, (tx) =>
      tx.execute(
        sql`update student_cards set status = 'revoked', revoked_at = now(), revoked_by = ${a.staffUserId}::uuid, revoke_reason = 'Lost'`,
      ),
    );
    await expectPgError(insert(a, { cardSeq: 3, code: 'IS-0001-2' }), '23505');
    await expectPgError(insert(a, { cardSeq: 2, code: 'IS-0001-3' }), '23505');
    await insert(a, { cardSeq: 3, code: 'IS-0001-3' });
  });
  it('requires barcode, distinct formats, positive sequence, correct temporary and lifecycle fields', async () => {
    for (const changes of [
      { cardSeq: 0 },
      { formats: [] },
      { formats: ['qr'] },
      { formats: ['barcode', 'barcode'] },
      { kind: 'temporary' },
      {
        kind: 'temporary',
        formats: ['barcode', 'qr'],
        status: 'active',
        activatedAt: new Date(),
        activatedBy: b.staffUserId,
      },
      { status: 'revoked' },
      { status: 'active' },
      { activatedAt: new Date() },
      { nfcUid: '04A21B9C' },
      { formats: ['barcode', 'nfc'], nfcUid: '04:a2:1b:9c' },
    ] satisfies Partial<typeof studentCards.$inferInsert>[])
      await expectPgError(insert(b, changes), '23514');
    await expectPgError(
      withTenant(db.app, b.tenantId, (tx) =>
        tx.execute(sql`update student_cards set status = 'revoked'`),
      ),
      '23514',
    );
    await expectPgError(
      withTenant(db.app, b.tenantId, (tx) =>
        tx.execute(sql`update student_cards set revoked_at = now()`),
      ),
      '23514',
    );
  });
  it('reserves NFC UIDs across revoked rows and forbids removing or replacing a linked UID', async () => {
    await insert(b, { formats: ['barcode', 'nfc'], nfcUid: '04A21B9C' });
    await withTenant(db.app, b.tenantId, (tx) =>
      tx.execute(
        sql`update student_cards set status = 'revoked', revoked_at = now(), revoked_by = ${b.staffUserId}::uuid, revoke_reason = 'Cancelled' where card_seq = 2`,
      ),
    );
    await expectPgError(
      insert(b, { cardSeq: 3, code: 'IS-0001-3', formats: ['barcode', 'nfc'], nfcUid: '04A21B9C' }),
      '23505',
    );
    for (const nfcUid of [null, '11223344'])
      await expectPgError(
        withTenant(db.app, b.tenantId, (tx) =>
          tx.execute(sql`update student_cards set nfc_uid = ${nfcUid} where card_seq = 2`),
        ),
        '23514',
      );
    await expectPgError(
      withTenant(db.app, b.tenantId, (tx) =>
        tx.execute(
          sql`update student_cards set status = 'ordered', revoked_at = null, revoked_by = null, revoke_reason = null where card_seq = 2`,
        ),
      ),
      '23514',
    );
  });
});
