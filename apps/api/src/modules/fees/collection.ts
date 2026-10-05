import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { schema, type Tx } from '@remix/db';
import type { CashPaymentRequest, ManualPaymentRequest } from '@remix/types/api';
import { AppException } from '../../common/errors/app-exception';
import { calendarDate } from '../../common/time/business-date';
import { AuditService } from '../audit/audit.service';
import { feeNotFound, lockLedger, recordPayment } from './ledger';
import { safeCents } from './projections';

const { payments, auditLogs, invoiceLines, invoices, paymentAllocations } = schema;

/** Hash validated fields in a fixed order; avoid copying references or notes into audits. */
export function cashFingerprint(body: CashPaymentRequest): string {
  return createHash('sha256').update(JSON.stringify(['cash', body.studentId,
    body.lineIds, body.cashReceivedCents])).digest('hex');
}

export function validateCash(received: number, total: number): void {
  if (received < total) throw new AppException('VALIDATION_FAILED', 400, 'Cash received must cover the selected months');
}

/** Replay before balance checks: a successful retry necessarily targets now-paid lines. */
async function replay(tx: Tx, key: string, fingerprint: string) {
  const [existing] = await tx.select().from(payments).where(eq(payments.idempotencyKey, key));
  if (!existing) return false;
  const [audit] = await tx.select({ after: auditLogs.after }).from(auditLogs)
    .where(and(eq(auditLogs.entityId, existing.id), eq(auditLogs.action, 'payment.record')));
  const after = audit?.after;
  if (!after || typeof after !== 'object' || !('requestFingerprint' in after) || after.requestFingerprint !== fingerprint) {
    throw new AppException('CONFLICT', 409, 'Idempotency key was used with a different request');
  }
  return true;
}

/** Under the ledger lock; RLS hides foreign tenant ids before ownership checks. */
async function openSelection(tx: Tx, studentId: string, lineIds: string[]) {
  if (new Set(lineIds).size !== lineIds.length) throw new AppException('VALIDATION_FAILED', 400, 'Choose each month once');
  const selected = await tx.select({ line: invoiceLines, studentId: invoices.studentId }).from(invoiceLines)
    .innerJoin(invoices, and(eq(invoices.tenantId, invoiceLines.tenantId), eq(invoices.id, invoiceLines.invoiceId)))
    .where(inArray(invoiceLines.id, lineIds)).orderBy(asc(invoiceLines.month), asc(invoiceLines.id))
    .for('update', { of: invoiceLines });
  if (selected.length !== lineIds.length || selected.some(r => r.studentId !== studentId)) throw feeNotFound();
  if (selected.some(r => r.line.voidedAt)) throw new AppException('VALIDATION_FAILED', 400, 'Voided months cannot be collected');
  const sums = await tx.select({ id: paymentAllocations.invoiceLineId, paid: sql<string>`sum(${paymentAllocations.amountCents})` })
    .from(paymentAllocations).where(inArray(paymentAllocations.invoiceLineId, lineIds)).groupBy(paymentAllocations.invoiceLineId);
  const paid = new Map(sums.map(r => [r.id, safeCents(r.paid)]));
  const balances = selected.map(r => r.line.amountCents - (paid.get(r.line.id) ?? 0));
  if (balances.some(n => n <= 0)) throw new AppException('ALREADY_PAID', 409, 'A selected month is already paid');
  const first = selected[0];
  if (!first) throw feeNotFound();
  return { total: safeCents(balances.reduce((a, b) => a + b, 0)), oldestMonth: first.line.month };
}

export async function collectCash(tx: Tx, body: CashPaymentRequest, actorId: string, now: Date, audit: AuditService) {
  await lockLedger(tx);
  const requestFingerprint = cashFingerprint(body);
  const isReplay = await replay(tx, body.idempotencyKey, requestFingerprint);
  const total = isReplay ? 0 : (await openSelection(tx, body.studentId, body.lineIds)).total;
  if (!isReplay) validateCash(body.cashReceivedCents, total);
  return recordPayment(tx, { method: 'cash', studentId: body.studentId, lines: body.lineIds,
    amountCents: total, cashReceivedCents: body.cashReceivedCents, idempotencyKey: body.idempotencyKey,
    receivedBy: actorId, requestFingerprint }, now, audit);
}

export function manualFingerprint(body: ManualPaymentRequest): string {
  return createHash('sha256').update(JSON.stringify(['manual', body.studentId, body.lineIds,
    body.kind, body.reference, body.receivedOn, body.note ?? null])).digest('hex');
}

export function validateReceivedOn(date: string, oldestMonth: string, now: Date): void {
  const earliest = `${Number(oldestMonth.slice(0, 4)) - 1}${oldestMonth.slice(4)}`;
  if (date > calendarDate(now) || date < earliest) {
    throw new AppException('VALIDATION_FAILED', 400, 'Received date must be between the oldest month minus one year and today');
  }
}

export async function collectManual(tx: Tx, body: ManualPaymentRequest, actorId: string, now: Date, audit: AuditService) {
  await lockLedger(tx);
  const requestFingerprint = manualFingerprint(body);
  const isReplay = await replay(tx, body.idempotencyKey, requestFingerprint);
  let total = 0;
  if (!isReplay) {
    const selected = await openSelection(tx, body.studentId, body.lineIds);
    validateReceivedOn(body.receivedOn, selected.oldestMonth, now);
    total = selected.total;
  }
  // The input is a business date, not a claimed clock time. UTC noon stays on that date in Colombo.
  const receivedAt = new Date(`${body.receivedOn}T12:00:00Z`);
  return recordPayment(tx, { method: 'manual', studentId: body.studentId, lines: body.lineIds,
    amountCents: total, idempotencyKey: body.idempotencyKey, receivedBy: actorId,
    providerRef: body.reference, note: body.note, receivedAt, requestFingerprint, manualKind: body.kind }, now, audit);
}
