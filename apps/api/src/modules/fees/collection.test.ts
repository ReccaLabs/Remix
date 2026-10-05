import { describe, expect, it } from 'vitest';
import { cashFingerprint, validateCash } from './collection';

describe('cash collection validation (FEE-07)', () => {
  it('accepts exact cash and change, refuses insufficient cash', () => {
    expect(() => validateCash(500_000, 500_000)).not.toThrow();
    expect(() => validateCash(600_000, 500_000)).not.toThrow();
    expect(() => validateCash(499_999, 500_000)).toThrow('400 VALIDATION_FAILED');
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
