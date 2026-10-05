import { describe, expect, it } from 'vitest';
import { cashFingerprint, manualFingerprint, validateCash, validateReceivedOn } from './collection';

describe('cash collection validation (FEE-07)', () => {
  it('accepts exact cash and change, refuses insufficient cash', () => {
    expect(() => { validateCash(500_000, 500_000); }).not.toThrow();
    expect(() => { validateCash(600_000, 500_000); }).not.toThrow();
    expect(() => { validateCash(499_999, 500_000); }).toThrow('400 VALIDATION_FAILED');
  });
  it('identifies every field independently of object property order', () => {
    const body = { studentId: 'student', lineIds: ['a', 'b'], cashReceivedCents: 600_000, idempotencyKey: 'key' };
    const hash = cashFingerprint(body);
    expect(cashFingerprint({ ...body })).toBe(hash);
    for (const change of [{ studentId: 'other' }, { lineIds: ['a'] }, { cashReceivedCents: 500_000 }]) {
      expect(cashFingerprint({ ...body, ...change })).not.toBe(hash);
    }
  });
});

describe('manual business dates and identity (FEE-08)', () => {
  it('uses the Colombo calendar day and an inclusive oldest month minus one year', () => {
    const now = new Date('2026-10-14T20:00:00Z');
    expect(() => { validateReceivedOn('2026-10-15', '2026-09-01', now); }).not.toThrow();
    expect(() => { validateReceivedOn('2025-09-01', '2026-09-01', now); }).not.toThrow();
    expect(() => { validateReceivedOn('2026-10-16', '2026-09-01', now); }).toThrow('400 VALIDATION_FAILED');
    expect(() => { validateReceivedOn('2025-08-31', '2026-09-01', now); }).toThrow('400 VALIDATION_FAILED');
  });
  it('fingerprints kind, reference, received date, note, student and selected lines', () => {
    const body = { studentId: 's', lineIds: ['l'], kind: 'cheque' as const, reference: 'r', receivedOn: '2026-10-15', idempotencyKey: 'key' };
    const hash = manualFingerprint(body);
    for (const change of [{ kind: 'other' as const }, { reference: 'x' }, { receivedOn: '2026-10-14' },
      { note: 'x' }, { studentId: 'x' }, { lineIds: ['x'] }]) {
      expect(manualFingerprint({ ...body, ...change })).not.toBe(hash);
    }
  });
});
