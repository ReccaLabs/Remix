import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/tenant';
import { connectAll, expectPgError, rolledBack, Rollback } from './support';
import { createWorld, type World } from './tables';

const db = connectAll();
let a: World; let b: World;
beforeAll(async () => { a = await createWorld(db.owner, 'money-a'); b = await createWorld(db.owner, 'money-b'); });
describe('SET-02/03 settings database enforcement', () => {
  for (const [table, column] of [['tenant_integrations', 'config'], ['tenant_settings', 'receipt_footer']] as const) {
    it(`${table}: mutable fields stay tenant-bound and identity cannot change`, async () => {
      await rolledBack(withTenant(db.app, a.tenantId, async tx => {
        expect((await tx.execute(sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = ${sql.identifier(column)} where tenant_id = ${b.tenantId}`)).rowCount).toBe(0);
        expect((await tx.execute(sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = ${sql.identifier(column)}`)).rowCount).toBe(1);
        throw new Rollback();
      }));
      await expectPgError(withTenant(db.app, a.tenantId, tx => tx.execute(sql`update ${sql.identifier(table)} set tenant_id = ${b.tenantId}`)), '42501');
    });
  }
  it('rejects malformed encryption envelopes and duplicate integration kinds', async () => {
    await expectPgError(withTenant(db.app, a.tenantId, tx => tx.execute(sql`update tenant_integrations set secret_nonce = decode('00', 'hex')`)), '23514');
    await expectPgError(withTenant(db.app, a.tenantId, tx => tx.execute(sql`insert into tenant_integrations (tenant_id, kind, config) values (${a.tenantId}, 'payhere', '{}')`)), '23505');
    await expectPgError(withTenant(db.readonly, a.tenantId, tx => tx.execute(sql`select secret_ciphertext from tenant_integrations`)), '42501');
  });
  it('mirrors reminder and template contract bounds', async () => {
    for (const change of [sql`remind_before_days = -1`, sql`remind_before_days = 11`, sql`remind_after_days = 0`, sql`remind_after_days = 31`, sql`receipt_address = repeat('x',201)`, sql`receipt_phone = repeat('x',41)`, sql`receipt_footer = repeat('x',201)`]) {
      await expectPgError(withTenant(db.app, a.tenantId, tx => tx.execute(sql`update tenant_settings set ${change}`)), '23514');
    }
  });
  it('rejects incomplete, oversized, mistyped and unknown bank fields', async () => {
    const bank = { bankName: 'Sample Bank', branch: 'Colombo', accountNumber: '123456', accountName: 'Sample Institute' };
    for (const value of [{}, { ...bank, branch: null }, { ...bank, bankName: 'x'.repeat(81) }, { ...bank, extra: 'bad' }, { ...bank, accountNumber: 'abcdef' }]) {
      await expectPgError(withTenant(db.app, a.tenantId, tx => tx.execute(sql`update tenant_settings set bank_details = ${JSON.stringify(value)}::jsonb`)), '23514');
    }
    await rolledBack(withTenant(db.app, a.tenantId, async tx => {
      await tx.execute(sql`update tenant_settings set bank_details = ${JSON.stringify(bank)}::jsonb, remind_before_days = 10, remind_after_days = 30`);
      throw new Rollback();
    }));
  });
});
