import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { allocateNumbers, schema, type Tx } from '@remix/db';
import type { PaymentMethod } from '@remix/types/api';
import { AppException } from '../../common/errors/app-exception';
import { calendarDate } from '../../common/time/business-date';
import { AuditService } from '../audit/audit.service';
import { recomputeProjections, safeCents } from './projections';

const { invoiceLines, invoices, paymentAllocations, payments, receipts, tenants } = schema;
export const feeNotFound = () => new AppException('NOT_FOUND', 404, 'Fee record not found');
const conflict = (message: string) => new AppException('CONFLICT', 409, message);

/**
 * One transaction lock per tenant. Coordinates generation, voids and distinct-line payments on
 * the same invoice as well as idempotency. Tenants remain independent. Line FOR UPDATE locks
 * additionally protect the allocation balances. Never lock append-only payments FOR UPDATE:
 * Postgres would require an UPDATE grant on them.
 */
export async function lockLedger(tx: Tx): Promise<string> {
  const [row] = (await tx.execute<{ id: string | null }>(sql`select public.app_tenant_id() as id`)).rows;
  if (!row?.id) throw new Error('Ledger requires withTenant');
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`fees:${row.id}`}, 0))`);
  return row.id;
}

export interface RecordPaymentInput {
  method: Exclude<PaymentMethod, 'reversal'>;
  amountCents: number;
  lines: readonly string[];
  idempotencyKey: string;
  receivedBy: string | null;
  studentId?: string;
  providerRef?: string;
  note?: string;
  receivedAt?: Date;
  cashReceivedCents?: number;
  /** Collection retry identity, stored atomically in the append-only audit. */
  requestFingerprint?: string;
  manualKind?: string;
}
export interface RecordedPayment {
  payment: typeof payments.$inferSelect;
  receiptId: string | null;
  receiptNumber: string | null;
  /** True when the idempotency key matched an earlier payment: nothing was written. */
  replayed: boolean;
}

async function result(tx: Tx, payment: typeof payments.$inferSelect, replayed: boolean): Promise<RecordedPayment> {
  const [receipt] = await tx.select().from(receipts).where(eq(receipts.paymentId, payment.id));
  return { payment, receiptId: receipt?.id ?? null, receiptNumber: receipt?.number ?? null, replayed };
}

/** Transactional engine for every collection method; callers deliver receipt hooks AFTER commit. */
export async function recordPayment(tx: Tx, input: RecordPaymentInput, now: Date, audit = new AuditService()): Promise<RecordedPayment> {
  const tenantId = await lockLedger(tx);
  const [existing] = await tx.select().from(payments).where(eq(payments.idempotencyKey, input.idempotencyKey));
  if (existing) return result(tx, existing, true);
  if (!['card', 'slip', 'cash', 'manual'].includes(input.method) || !Number.isSafeInteger(input.amountCents) || input.amountCents < 0) {
    throw new AppException('VALIDATION_FAILED', 400, 'Use non-negative integer cents and a collection method');
  }
  const ids = [...new Set(input.lines)];
  if (ids.length === 0) throw new AppException('VALIDATION_FAILED', 400, 'Choose invoice lines');
  const selected = await tx.select({ line: invoiceLines, studentId: invoices.studentId }).from(invoiceLines)
    .innerJoin(invoices, and(eq(invoices.tenantId, invoiceLines.tenantId), eq(invoices.id, invoiceLines.invoiceId)))
    .where(inArray(invoiceLines.id, ids)).orderBy(asc(invoiceLines.month), asc(invoiceLines.id))
    .for('update', { of: invoiceLines });
  const studentId = selected[0]?.studentId;
  if (selected.length !== ids.length || !studentId || selected.some(r => r.studentId !== studentId) || (input.studentId && input.studentId !== studentId)) throw feeNotFound();
  const sums = await tx.select({ lineId: paymentAllocations.invoiceLineId, paid: sql<string>`sum(${paymentAllocations.amountCents})` })
    .from(paymentAllocations).where(inArray(paymentAllocations.invoiceLineId, ids)).groupBy(paymentAllocations.invoiceLineId);
  const paid = new Map(sums.map(s => [s.lineId, safeCents(s.paid)]));
  const open = selected.map(({ line }) => ({ line, open: line.voidedAt ? 0 : line.amountCents - (paid.get(line.id) ?? 0) }));
  if (open.some(l => l.open < 0)) throw new Error('Ledger line is over-allocated');
  const total = safeCents(open.reduce((n, r) => n + r.open, 0));
  if (input.method !== 'card' && (input.amountCents !== total || selected.some(r => r.line.voidedAt))) throw conflict('Payment must exactly cover the selected open lines');
  if (input.cashReceivedCents !== undefined && (input.method !== 'cash' || !Number.isSafeInteger(input.cashReceivedCents) || input.cashReceivedCents < input.amountCents)) throw conflict('Cash received must cover the payment');
  let remaining = input.amountCents;
  const allocations = open.flatMap(({ line, open: balance }) => {
    const amountCents = Math.min(balance, remaining);
    remaining -= amountCents;
    return amountCents > 0 ? [{ tenantId, invoiceLineId: line.id, amountCents }] : [];
  });
  const [payment] = await tx.insert(payments).values({ tenantId, studentId, method: input.method,
    amountCents: input.amountCents, unallocatedCents: remaining, needsRefund: input.method === 'card' && remaining > 0,
    receivedBy: input.receivedBy, receivedAt: input.receivedAt ?? now,
    providerRef: input.providerRef ?? null, note: input.note ?? null, idempotencyKey: input.idempotencyKey }).returning();
  if (!payment) throw new Error('Payment not inserted');
  if (allocations.length) await tx.insert(paymentAllocations).values(allocations.map(a => ({ ...a, paymentId: payment.id })));
  await recomputeProjections(tx, now, [...new Set(selected.map(r => r.line.invoiceId))]);
  await audit.record(tx, tenantId, { action: 'payment.record', actorId: input.receivedBy, actorKind: input.receivedBy ? 'staff' : 'system', at: now,
    entity: 'payment', entityId: payment.id, after: { method: input.method, amountCents: input.amountCents, unallocatedCents: remaining, lines: allocations.length,
      ...(input.requestFingerprint ? { requestFingerprint: input.requestFingerprint } : {}),
      ...(input.manualKind ? { manualKind: input.manualKind } : {}) } });
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) throw feeNotFound();
  const year = calendarDate(now).slice(0, 4);
  const block = await allocateNumbers(tx, 'receipt', 1, year);
  const number = `${tenant.studentNoPrefix}-R-${year.slice(2)}-${String(block.first).padStart(5, '0')}`;
  const [receipt] = await tx.insert(receipts).values({ tenantId, paymentId: payment.id, number, issuedAt: now, cashReceivedCents: input.cashReceivedCents ?? null }).returning();
  if (!receipt) throw new Error('Receipt not inserted');
  return { payment, receiptId: receipt.id, receiptNumber: receipt.number, replayed: false };
}

/** Owner authorization is required by the HTTP guard and checked again by FeesService. */
export async function reversePayment(tx: Tx, paymentId: string, reason: string, receivedBy: string, now: Date, audit = new AuditService()): Promise<RecordedPayment> {
  const tenantId = await lockLedger(tx);
  if (reason.trim().length < 3 || reason.trim().length > 300) throw new AppException('VALIDATION_FAILED', 400, 'Give a reversal reason');
  const [original] = await tx.select().from(payments).where(eq(payments.id, paymentId));
  if (!original) throw feeNotFound();
  const [already] = await tx.select().from(payments).where(eq(payments.reversesPaymentId, paymentId));
  if (original.method === 'reversal' || already) throw conflict('Payment is already reversed or is a reversal');
  const allocations = await tx.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId));
  const lineIds = allocations.map(a => a.invoiceLineId);
  const lines = lineIds.length ? await tx.select().from(invoiceLines).where(inArray(invoiceLines.id, lineIds)).orderBy(asc(invoiceLines.id)).for('update') : [];
  const [payment] = await tx.insert(payments).values({ tenantId, studentId: original.studentId, method: 'reversal', amountCents: -original.amountCents,
    unallocatedCents: original.unallocatedCents, receivedBy, receivedAt: now, note: reason.trim(),
    idempotencyKey: `reversal:${paymentId}`, reversesPaymentId: paymentId }).returning();
  if (!payment) throw new Error('Reversal not inserted');
  if (allocations.length) await tx.insert(paymentAllocations).values(allocations.map(a => ({ tenantId, paymentId: payment.id, invoiceLineId: a.invoiceLineId, amountCents: -a.amountCents })));
  await tx.update(receipts).set({ reversedAt: now }).where(eq(receipts.paymentId, paymentId));
  await recomputeProjections(tx, now, [...new Set(lines.map(l => l.invoiceId))]);
  await audit.record(tx, tenantId, { action: 'payment.reverse', actorId: receivedBy, actorKind: 'staff', at: now, entity: 'payment', entityId: payment.id,
    after: { reversesPaymentId: paymentId, amountCents: payment.amountCents, reason: reason.trim() } });
  return { payment, receiptId: null, receiptNumber: null, replayed: false };
}
