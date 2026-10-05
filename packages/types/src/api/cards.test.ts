import { describe, expect, it } from 'vitest';
import { cardCodeSchema, issueStudentCardSchema, normalizeCardCode } from './cards';

describe('student cards (STU-06)', () => {
  it('normalises NFC UIDs and grouped barcode numbers', () => {
    expect(normalizeCardCode('04:a2:1b:9c')).toBe('04A21B9C');
    expect(normalizeCardCode(' 1234-5678 90 ')).toBe('1234567890');
    expect(cardCodeSchema.parse('rmx 7k2p-9qd4')).toBe('RMX7K2P9QD4');
  });

  it('rejects codes that are too short, too long or not alphanumeric', () => {
    expect(cardCodeSchema.safeParse('A1B').success).toBe(false);
    expect(cardCodeSchema.safeParse('A'.repeat(65)).success).toBe(false);
    expect(cardCodeSchema.safeParse('ABC/1234').success).toBe(false);
  });

  it('issues without a code and links with one; rejects unknown fields', () => {
    expect(issueStudentCardSchema.parse({ format: 'qr' })).toEqual({ format: 'qr' });
    expect(issueStudentCardSchema.parse({ format: 'nfc', code: '04:A2:1B:9C' }).code).toBe('04A21B9C');
    expect(issueStudentCardSchema.safeParse({ format: 'qr', studentId: 'x' }).success).toBe(false);
  });
});
