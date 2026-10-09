import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { creditSmsWallet, SmsWalletToolError } from '../src/sms-wallet';
import { withTenant } from '../src/tenant';
import { connectAll, expectPgError } from './support';
import { createWorld, type World } from './tables';

/** MSG-02: the wallet ledger rules, enforced by the database itself (migration 0020). */
const db = connectAll();
let w: World;

const credit = (tenantId: string, cents: number) =>
  withTenant(db.owner, tenantId, (tx) =>
    tx.execute(sql`insert into sms_wallet_ledger (tenant_id, kind, amount_cents, note) values (${tenantId}, 'top_up', ${cents}, 'test credit')`),
  );
const balance = async (tenantId: string): Promise<number> =>
  Number(
    (
      await withTenant(db.app, tenantId, (tx) =>
        tx.execute<{ b: string }>(sql`select balance_cents::text as b from sms_wallets`),
      )
    ).rows[0]?.b ?? 0,
  );
let n = 0;
/** One debit: the message row, then the ledger entry, in one transaction as the app role. */
const spend = (tenantId: string, cents: number, id = `m-${w.tag}-${++n}`) =>
  withTenant(db.app, tenantId, async (tx) => {
    await tx.execute(sql`insert into sms_messages (tenant_id, message_id, template, segments, cost_cents) values (${tenantId}, ${id}, 'fee.reminder', 1, ${cents})`);
    await tx.execute(sql`insert into sms_wallet_ledger (tenant_id, kind, amount_cents, message_id, segments) values (${tenantId}, 'send', ${-cents}, ${id}, 1)`);
    return id;
  });

beforeAll(async () => {
  w = await createWorld(db.owner, 'smswallet', false);
});

describe('SMS wallet ledger (database enforcement)', () => {
  it('computes balance_after and keeps the projection equal to the ledger sum', async () => {
    await credit(w.tenantId, 3000);
    expect(await balance(w.tenantId)).toBe(3000);
    await spend(w.tenantId, 500);
    const sum = await withTenant(db.app, w.tenantId, (tx) =>
      tx.execute<{ s: string; last: string }>(sql`select sum(amount_cents)::text as s, (array_agg(balance_after_cents order by created_at desc, id desc))[1]::text as last from sms_wallet_ledger`),
    );
    expect(sum.rows[0]?.s).toBe('2500');
    expect(sum.rows[0]?.last).toBe('2500');
    expect(await balance(w.tenantId)).toBe(2500);
  });

  it('concurrent debits never take the balance below zero', async () => {
    const t = await createWorld(db.owner, 'smswallet-race', false);
    await credit(t.tenantId, 2000);
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        withTenant(db.app, t.tenantId, async (tx) => {
          const id = `race-${t.tag}-${i}`;
          await tx.execute(sql`insert into sms_messages (tenant_id, message_id, template, segments, cost_cents) values (${t.tenantId}, ${id}, 'fee.reminder', 1, 500)`);
          await tx.execute(sql`insert into sms_wallet_ledger (tenant_id, kind, amount_cents, message_id, segments) values (${t.tenantId}, 'send', -500, ${id}, 1)`);
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4);
    for (const r of results) {
      if (r.status === 'rejected') expect(String((r.reason as Error).cause ?? r.reason)).toMatch(/INSUFFICIENT_SMS_BALANCE/);
    }
    expect(await balance(t.tenantId)).toBe(0);
  });

  it('refuses a debit larger than the balance', async () => {
    const t = await createWorld(db.owner, 'smswallet-low', false);
    await credit(t.tenantId, 400);
    await expectPgError(spend(t.tenantId, 500), '23514', /INSUFFICIENT_SMS_BALANCE/);
    expect(await balance(t.tenantId)).toBe(400);
  });

  it('a message can be debited once, and refunded once for the same amount', async () => {
    await credit(w.tenantId, 2000);
    const id = await spend(w.tenantId, 500);
    await expectPgError(
      withTenant(db.app, w.tenantId, (tx) => tx.execute(sql`insert into sms_wallet_ledger (tenant_id, kind, amount_cents, message_id) values (${w.tenantId}, 'send', -500, ${id})`)),
      '23505',
    );
    const refund = (cents: number) =>
      withTenant(db.app, w.tenantId, (tx) => tx.execute(sql`insert into sms_wallet_ledger (tenant_id, kind, amount_cents, message_id) values (${w.tenantId}, 'refund', ${cents}, ${id})`));
    await expectPgError(refund(300), '23514', /refund must match/);
    const before = await balance(w.tenantId);
    await refund(500);
    expect(await balance(w.tenantId)).toBe(before + 500);
    await expectPgError(refund(500), '23505');
  });

  it('a refund without a debit is rejected', async () => {
    await expectPgError(
      withTenant(db.app, w.tenantId, async (tx) => {
        await tx.execute(sql`insert into sms_messages (tenant_id, message_id, template, segments, cost_cents) values (${w.tenantId}, ${`nodebit-${w.tag}`}, 'fee.reminder', 1, 500)`);
        await tx.execute(sql`insert into sms_wallet_ledger (tenant_id, kind, amount_cents, message_id) values (${w.tenantId}, 'refund', 500, ${`nodebit-${w.tag}`})`);
      }),
      '23514',
    );
  });

  it('the app role cannot mint credit, edit the balance, or rewrite history', async () => {
    const run = (query: ReturnType<typeof sql>) => withTenant(db.app, w.tenantId, (tx) => tx.execute(query));
    await expectPgError(run(sql`insert into sms_wallet_ledger (tenant_id, kind, amount_cents, note) values (${w.tenantId}, 'top_up', 100000, 'free money')`), '42501', /row-level security/);
    await expectPgError(run(sql`insert into sms_wallet_ledger (tenant_id, kind, amount_cents, note) values (${w.tenantId}, 'adjustment', 100000, 'free money')`), '42501', /row-level security/);
    await expectPgError(run(sql`update sms_wallets set balance_cents = 999999999`), '23514', /only through the ledger/);
    await expectPgError(run(sql`update sms_wallets set sender_id = 'Hacked'`), '42501', /permission denied/);
    await expectPgError(run(sql`update sms_wallet_ledger set amount_cents = 1`), '42501', /permission denied/);
    await expectPgError(run(sql`delete from sms_wallet_ledger`), '42501', /permission denied/);
    await expectPgError(run(sql`insert into sms_wallet_ledger (tenant_id, kind, amount_cents, balance_after_cents, message_id) values (${w.tenantId}, 'send', -1, 999, 'x')`), '42501', /permission denied/);
  });

  it('staff adjustments need a note and cannot overdraw', async () => {
    const adjust = (cents: number, note: string | null) =>
      withTenant(db.owner, w.tenantId, (tx) => tx.execute(sql`insert into sms_wallet_ledger (tenant_id, kind, amount_cents, note) values (${w.tenantId}, 'adjustment', ${cents}, ${note})`));
    await expectPgError(adjust(-1, null), '23514');
    await expectPgError(adjust(-999_999_999, 'too much'), '23514', /INSUFFICIENT_SMS_BALANCE/);
    const before = await balance(w.tenantId);
    await adjust(-100, 'goodwill correction');
    expect(await balance(w.tenantId)).toBe(before - 100);
  });

  it('message status only moves forward', async () => {
    const id = await spend(w.tenantId, 100);
    const set = (status: string) =>
      withTenant(db.app, w.tenantId, (tx) => tx.execute(sql`update sms_messages set status = ${status} where message_id = ${id}`));
    await set('queued');
    await set('sent');
    await expectPgError(set('queued'), '23514');
    await expectPgError(set('failed'), '23514');
  });

  it('the low-balance flag clears on the next top-up', async () => {
    const t = await createWorld(db.owner, 'smswallet-flag', false);
    await credit(t.tenantId, 1000);
    await withTenant(db.app, t.tenantId, (tx) => tx.execute(sql`update sms_wallets set low_balance_alerted_at = now()`));
    await credit(t.tenantId, 100_000);
    const row = await withTenant(db.app, t.tenantId, (tx) => tx.execute<{ a: Date | null }>(sql`select low_balance_alerted_at as a from sms_wallets`));
    expect(row.rows[0]?.a).toBeNull();
  });

  it("another tenant's wallet is unaffected and invisible", async () => {
    const other = await createWorld(db.owner, 'smswallet-other', false);
    await credit(other.tenantId, 1234);
    expect(await balance(other.tenantId)).toBe(1234);
    expect(await balance(w.tenantId)).not.toBe(1234);
    await expectPgError(
      withTenant(db.app, w.tenantId, (tx) => tx.execute(sql`insert into sms_wallet_ledger (tenant_id, kind, amount_cents, message_id) values (${other.tenantId}, 'send', -1, 'y')`)),
      '42501',
      /row-level security/,
    );
  });
});

describe('creditSmsWallet (staff tooling)', () => {
  it('credits, settles the request, sets the sender id and writes an audit row', async () => {
    const t = await createWorld(db.owner, 'smswallet-cli', false);
    const request = await withTenant(db.app, t.tenantId, (tx) =>
      tx.execute<{ id: string }>(sql`insert into sms_top_up_requests (tenant_id, amount_cents, requested_by) values (${t.tenantId}, 200000, ${t.staffUserId}) returning id`),
    );
    const requestId = request.rows[0]?.id ?? '';
    const result = await creditSmsWallet(db.owner, {
      slug: t.slug,
      amountCents: 200_000,
      note: 'Invoice 123 paid',
      requestId,
      senderId: 'KamalPhys',
      lowBalanceThresholdCents: 30_000,
    });
    expect(result).toMatchObject({ tenantId: t.tenantId, balanceCents: 200_000, senderId: 'KamalPhys' });
    const state = await withTenant(db.app, t.tenantId, async (tx) => ({
      request: (await tx.execute<{ status: string }>(sql`select status from sms_top_up_requests`)).rows[0]?.status,
      audit: (await tx.execute<{ action: string }>(sql`select action from audit_logs where action like 'sms.%'`)).rows.map((r) => r.action),
    }));
    expect(state).toEqual({ request: 'credited', audit: ['sms.wallet_top_up'] });
    await expect(creditSmsWallet(db.owner, { slug: t.slug, amountCents: 100, note: 'again', requestId })).rejects.toThrow(/already credited/);
    await expect(creditSmsWallet(db.owner, { slug: t.slug, amountCents: 100 })).rejects.toThrow();
    await expect(creditSmsWallet(db.owner, { slug: 'no-such-tenant-xx', amountCents: 100, note: 'nope' })).rejects.toBeInstanceOf(SmsWalletToolError);
  });
});
