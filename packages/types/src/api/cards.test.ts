import { describe, expect, it } from 'vitest';
import {
  activateStudentCardSchema,
  cardInputSchema,
  issueStudentCardSchema,
  nfcUidSchema,
  normalizeCardInput,
} from './cards';

describe('student cards (STU-06)', () => {
  it('keeps dashes so card codes cannot collide', () => {
    expect(normalizeCardInput(' nil-26-0042-1 ')).toBe('NIL-26-0042-1');
    expect(normalizeCardInput('NIL-26-0042-1')).not.toBe(normalizeCardInput('NIL-26-00421'));
    expect(cardInputSchema.parse('nil-26-0042')).toBe('NIL-26-0042');
  });

  it('normalises NFC chip UIDs and rejects non-hex', () => {
    expect(nfcUidSchema.parse('04:a2:1b:9c')).toBe('04A21B9C');
    expect(nfcUidSchema.parse('04-A2-1B-9C-11-22-33')).toBe('04A21B9C112233');
    expect(nfcUidSchema.safeParse('04:A2:1B').success).toBe(false);
    expect(nfcUidSchema.safeParse('ZZ:A2:1B:9C').success).toBe(false);
  });

  it('rejects inputs that are too short, too long or not plain ASCII', () => {
    expect(cardInputSchema.safeParse('AB').success).toBe(false);
    expect(cardInputSchema.safeParse('A'.repeat(65)).success).toBe(false);
    expect(cardInputSchema.safeParse('NIL-26-අ').success).toBe(false);
  });

  it('temporary cards take no formats; permanent cards always include a barcode', () => {
    expect(issueStudentCardSchema.parse({ kind: 'temporary' })).toEqual({ kind: 'temporary' });
    expect(issueStudentCardSchema.safeParse({ kind: 'temporary', formats: ['qr'] }).success).toBe(false);
    expect(issueStudentCardSchema.safeParse({ kind: 'permanent', formats: ['barcode'] }).success).toBe(true);
    expect(
      issueStudentCardSchema.safeParse({ kind: 'permanent', formats: ['barcode', 'qr', 'nfc'] }).success,
    ).toBe(true);
    expect(issueStudentCardSchema.safeParse({ kind: 'permanent', formats: ['qr', 'nfc'] }).success).toBe(false);
    expect(
      issueStudentCardSchema.safeParse({ kind: 'permanent', formats: ['barcode', 'barcode'] }).success,
    ).toBe(false);
  });

  it('activation optionally links a chip UID', () => {
    expect(activateStudentCardSchema.parse({})).toEqual({});
    expect(activateStudentCardSchema.parse({ nfcUid: '04 a2 1b 9c' }).nfcUid).toBe('04A21B9C');
  });
});
