import { eq } from 'drizzle-orm';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, withTenant, type Db } from '@remix/db';
import type { AuthSession } from '../../src/common/auth/session-authenticator';
import { voidEndedLines } from '../../src/modules/fees/invoice-generation';
import {
  createDbTestApp,
  Factory,
  ownerDb,
  START,
  type DbTestApp,
  type TenantFixture,
  type UserFixture,
} from './support/db-app';
import { appDb, assertLedgerInvariants, feesOf, lines } from './support/fees';

const MONTHS = ['2026-08', '2026-09', '2026-10', '2026-11'] as const;
const FEES = [0, 150_000, 250_000, 80_050] as const;

type Op =
  | { k: 'gen'; m: number }
  | { k: 'cash'; s: number }
  | { k: 'manual'; s: number }
  | { k: 'card'; s: number; amount: number; pick: number }
  | { k: 'payrev'; s: number; card: boolean; amount: number }
  | { k: 'rev'; i: number }
  | { k: 'void'; s: number; cutoff: number }
  | { k: 'replay'; i: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ k: fc.constant('gen' as const), m: fc.nat(MONTHS.length - 1) }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant('cash' as const), s: fc.nat(2) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('manual' as const), s: fc.nat(2) }) },
  {
    weight: 4,
    arbitrary: fc.record({
      k: fc.constant('card' as const),
      s: fc.nat(2),
      amount: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 700_000 }), fc.constantFrom(...FEES)),
      pick: fc.nat(1023),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      k: fc.constant('payrev' as const),
      s: fc.nat(2),
      card: fc.boolean(),
      amount: fc.integer({ min: 0, max: 600_000 }),
    }),
  },
  { weight: 3, arbitrary: fc.record({ k: fc.constant('rev' as const), i: fc.nat(30) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('void' as const), s: fc.nat(2), cutoff: fc.nat(MONTHS.length - 1) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('replay' as const), i: fc.nat(30) }) },
);

describe('ledger invariants under random operation sequences (property tests, real Postgres)', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  const fees = () => feesOf(t);
  let seq = 0;

  beforeAll(async () => {
    t = await createDbTestApp();
    db = ownerDb();
    f = new Factory(db);
    t.clock.set(START);
  });
  afterAll(async () => {
    await t.close();
    await db.$client.end();
  });

  async function arrange(): Promise<{ tenant: TenantFixture; owner: UserFixture; students: UserFixture[]; enrollmentIds: string[] }> {
    const tenant = await f.tenant('active');
    const owner = await f.staff(tenant, ['owner']);
    const klassA = await f.klass(tenant, { name: 'A', feeCents: FEES[2] });
    const klassB = await f.klass(tenant, { name: 'B', feeCents: FEES[seq++ % FEES.length]! });
    const students: UserFixture[] = [];
    for (let i = 0; i < 3; i++) {
      const s = await f.student(tenant);
      students.push(s);
      await f.enroll(tenant, s.id, klassA, { from: '2026-08-01' });
      if (i !== 1) await f.enroll(tenant, s.id, klassB, { from: '2026-09-01', feeOverrideCents: i === 2 ? 99_999 : undefined });
    }
    const enrollmentIds = (
      await db.select({ id: schema.enrollments.id }).from(schema.enrollments).where(eq(schema.enrollments.tenantId, tenant.id))
    ).map((e) => e.id);
    return { tenant, owner, students, enrollmentIds };
  }

  it('every ledger invariant holds after every step of any sequence of generation, payments, reversals and voids', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 14 }), async (ops) => {
        const { tenant, owner, students, enrollmentIds } = await arrange();
        const session = { userId: owner.id, roles: ['owner'], tenantId: tenant.id } as unknown as AuthSession;
        const payments: { id: string; key: string; reversed: boolean }[] = [];
        let n = 0;
        const key = () => `p-${seq}-${n++}`;
        const open = async (s: number) =>
          (await lines(db, tenant.id)).filter((l) => l.student_id === students[s]!.id && !l.voided && l.amount_cents - l.paid > 0);

        for (const op of ops) {
          switch (op.k) {
            case 'gen':
              await fees().generateInvoices(tenant.id, MONTHS[op.m]!);
              break;
            case 'cash':
            case 'manual': {
              const ls = await open(op.s);
              if (!ls.length) break;
              const k = key();
              const r = await fees().recordPayment(tenant.id, {
                method: op.k,
                amountCents: ls.reduce((a, l) => a + l.amount_cents - l.paid, 0),
                lines: ls.map((l) => l.id),
                idempotencyKey: k,
                receivedBy: owner.id,
              });
              payments.push({ id: r.payment.id, key: k, reversed: false });
              break;
            }
            case 'card': {
              const all = (await lines(db, tenant.id)).filter((l) => l.student_id === students[op.s]!.id);
              const chosen = all.filter((_, i) => (op.pick >> i) & 1);
              const pickLines = chosen.length ? chosen : all.slice(0, 1);
              if (!pickLines.length) break;
              const k = key();
              const r = await fees().recordPayment(tenant.id, {
                method: 'card',
                amountCents: op.amount,
                lines: pickLines.map((l) => l.id),
                idempotencyKey: k,
                receivedBy: null,
              });
              payments.push({ id: r.payment.id, key: k, reversed: false });
              break;
            }
            case 'payrev': {
              // Pay, then reverse that very payment: every line must be exactly as it was.
              const all = (await lines(db, tenant.id)).filter((l) => l.student_id === students[op.s]!.id);
              if (!all.length) break;
              const before = await lines(db, tenant.id);
              const openLines = all.filter((l) => !l.voided && l.amount_cents - l.paid > 0);
              const useCard = op.card || !openLines.length;
              const r = await fees().recordPayment(tenant.id, {
                method: useCard ? 'card' : 'cash',
                amountCents: useCard ? op.amount : openLines.reduce((a, l) => a + l.amount_cents - l.paid, 0),
                lines: (useCard ? all : openLines).map((l) => l.id),
                idempotencyKey: key(),
                receivedBy: owner.id,
              });
              await fees().reversePayment(tenant.id, session, r.payment.id, 'Property test reversal');
              expect(await lines(db, tenant.id)).toEqual(before);
              break;
            }
            case 'rev': {
              const candidates = payments.filter((p) => !p.reversed);
              const target = candidates[op.i % Math.max(candidates.length, 1)];
              if (!target) break;
              const before = await lines(db, tenant.id);
              const original = await fees().getPayment(tenant.id, target.id);
              await fees().reversePayment(tenant.id, session, target.id, 'Property test reversal');
              target.reversed = true;
              const after = await lines(db, tenant.id);
              // Reversing removes exactly the lines' share of this payment and nothing else.
              for (const l of before) {
                const share = original.lines.filter((x) => x.lineId === l.id).reduce((a, x) => a + x.amountCents, 0);
                expect(after.find((x) => x.id === l.id)!.paid, `line ${l.id}`).toBe(l.paid - share);
              }
              break;
            }
            case 'void': {
              const student = students[op.s]!;
              const mine = await db
                .select()
                .from(schema.enrollments)
                .where(eq(schema.enrollments.studentId, student.id));
              const cutoff = `${MONTHS[op.cutoff]}-01`;
              for (const e of mine) {
                if (cutoff < e.fromMonth) continue;
                await db.update(schema.enrollments).set({ toMonth: cutoff }).where(eq(schema.enrollments.id, e.id));
              }
              await withTenant(appDb(t), tenant.id, (tx) => voidEndedLines(tx, enrollmentIds, 'Enrolment ended', t.clock.now()));
              break;
            }
            case 'replay': {
              const target = payments[op.i % Math.max(payments.length, 1)];
              if (!target) break;
              const original = await fees().getPayment(tenant.id, target.id);
              const again = await fees().recordPayment(tenant.id, {
                method: original.method === 'reversal' ? 'cash' : original.method,
                amountCents: original.amountCents,
                lines: original.lines.length ? original.lines.map((l) => l.lineId) : [(await lines(db, tenant.id))[0]?.id ?? ''],
                idempotencyKey: target.key,
                receivedBy: null,
              });
              expect(again.replayed).toBe(true);
              expect(again.payment.id).toBe(target.id);
              break;
            }
          }
          await assertLedgerInvariants(db, t, tenant);
        }
      }),
      { numRuns: 25, interruptAfterTimeLimit: 240_000, markInterruptAsFailure: false },
    );
  }, 300_000);

  it('a paid line stays paid exactly while its allocations cover it: paying, reversing and re-paying cycles', async () => {
    const { tenant, owner, students } = await arrange();
    const session = { userId: owner.id, roles: ['owner'], tenantId: tenant.id } as unknown as AuthSession;
    await fees().generateInvoices(tenant.id, '2026-10');
    const [l] = (await lines(db, tenant.id)).filter((x) => x.student_id === students[0]!.id);
    for (let i = 0; i < 4; i++) {
      const p = await fees().recordPayment(tenant.id, { method: 'cash', amountCents: l!.amount_cents, lines: [l!.id], idempotencyKey: `cycle-${i}`, receivedBy: owner.id });
      expect(await fees().canAccess(tenant.id, students[0]!.id, l!.class_id, '2026-10')).toBe(true);
      await fees().reversePayment(tenant.id, session, p.payment.id, 'Cycle reversal');
      expect(await fees().canAccess(tenant.id, students[0]!.id, l!.class_id, '2026-10')).toBe(false);
    }
    await assertLedgerInvariants(db, t, tenant);
    expect((await lines(db, tenant.id)).find((x) => x.id === l!.id)!.paid).toBe(0);
  });
});
