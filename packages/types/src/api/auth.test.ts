import { describe, expect, it } from 'vitest';
import {
  newPasswordSchema,
  parseStaffIdentifier,
  staffLoginRequestSchema,
  studentLoginRequestSchema,
} from './auth';

describe('studentLoginRequestSchema', () => {
  it('normalises the phone and defaults staySignedIn', () => {
    expect(studentLoginRequestSchema.parse({ phone: '077 123 4567', password: 'p' })).toEqual({
      phone: '+94771234567',
      password: 'p',
      staySignedIn: false,
    });
  });

  it('rejects unknown fields', () => {
    const r = studentLoginRequestSchema.safeParse({
      phone: '0771234567',
      password: 'p',
      tenantId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    });
    expect(r.success).toBe(false);
  });

  it('caps password length (hashing cost)', () => {
    const r = studentLoginRequestSchema.safeParse({
      phone: '0771234567',
      password: 'x'.repeat(129),
    });
    expect(r.success).toBe(false);
  });

  it('rejects an empty password', () => {
    expect(studentLoginRequestSchema.safeParse({ phone: '0771234567', password: '' }).success).toBe(
      false,
    );
  });
});

describe('staffLoginRequestSchema', () => {
  it('accepts an email or phone identifier', () => {
    expect(
      staffLoginRequestSchema.parse({ identifier: ' kamal@example.com ', password: 'p' }),
    ).toMatchObject({
      identifier: 'kamal@example.com',
    });
  });
});

describe('parseStaffIdentifier', () => {
  it('detects a Sri Lankan mobile', () => {
    expect(parseStaffIdentifier('071 555 0101')).toEqual({ kind: 'phone', phone: '+94715550101' });
  });

  it('detects and lower-cases an email', () => {
    expect(parseStaffIdentifier('Kamal@Example.com')).toEqual({
      kind: 'email',
      email: 'kamal@example.com',
    });
  });

  it.each(['kamal', '0112345678', '@example.com'])('returns null for %s', (value) => {
    expect(parseStaffIdentifier(value)).toBeNull();
  });
});

describe('newPasswordSchema', () => {
  it('requires 8–128 characters', () => {
    expect(newPasswordSchema.safeParse('1234567').success).toBe(false);
    expect(newPasswordSchema.safeParse('12345678').success).toBe(true);
    expect(newPasswordSchema.safeParse('x'.repeat(129)).success).toBe(false);
  });
});
