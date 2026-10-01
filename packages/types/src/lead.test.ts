import { describe, expect, it } from 'vitest';
import { leadRequestSchema, leadSchema } from './lead';
import { sriLankaMobile } from './phone';

const valid = {
  name: 'Kamal Jayasinghe',
  phone: '077 123 4567',
  whatsappSame: true,
  institute: 'Kamal Physics',
  students: 300,
  city: 'Colombo',
  intent: 'demo',
} as const;

describe('sriLankaMobile', () => {
  it.each([
    '0771234567',
    '771234567',
    '+94 77 123 4567',
    '94771234567',
    '0094771234567',
    '077-123-4567',
    '(077) 123 4567',
  ])('normalises %s to +94771234567', (input) => {
    expect(sriLankaMobile.parse(input)).toBe('+94771234567');
  });

  it.each([
    ['landline', '0112345678'],
    ['landline with +94', '+94112345678'],
    ['too short', '077123456'],
    ['too long', '07712345678'],
    ['letters', '077123456a'],
    ['empty', ''],
    ['foreign number', '+447712345678'],
  ])('rejects %s (%s)', (_label, input) => {
    expect(sriLankaMobile.safeParse(input).success).toBe(false);
  });
});

describe('leadSchema', () => {
  it('accepts a valid lead and normalises it', () => {
    const lead = leadSchema.parse({ ...valid, name: '  Kamal Jayasinghe ', message: '' });
    expect(lead).toEqual({
      name: 'Kamal Jayasinghe',
      phone: '+94771234567',
      whatsappSame: true,
      institute: 'Kamal Physics',
      students: 300,
      city: 'Colombo',
      message: undefined,
      intent: 'demo',
    });
  });

  it('applies defaults for whatsappSame and intent', () => {
    const { whatsappSame: _w, intent: _i, ...rest } = valid;
    const lead = leadSchema.parse(rest);
    expect(lead.whatsappSame).toBe(true);
    expect(lead.intent).toBe('demo');
  });

  it('rejects unknown keys (strict object)', () => {
    const result = leadSchema.safeParse({ ...valid, isAdmin: true });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('accepts digit strings for students but rejects junk', () => {
    expect(leadSchema.parse({ ...valid, students: '450' }).students).toBe(450);
    expect(leadSchema.safeParse({ ...valid, students: '4.5' }).success).toBe(false);
    expect(leadSchema.safeParse({ ...valid, students: 0 }).success).toBe(false);
    expect(leadSchema.safeParse({ ...valid, students: 100_001 }).success).toBe(false);
    expect(leadSchema.safeParse({ ...valid, students: true }).success).toBe(false);
  });

  it('rejects control characters and bidi overrides in single-line fields', () => {
    expect(leadSchema.safeParse({ ...valid, institute: 'Kamal\r\nBcc: x' }).success).toBe(false);
    expect(leadSchema.safeParse({ ...valid, name: 'Kamal‮evil' }).success).toBe(false);
  });

  it('keeps Sinhala names with zero-width joiners', () => {
    const name = 'ශ්‍රී ලංකා';
    expect(leadSchema.parse({ ...valid, name }).name).toBe(name.normalize('NFC'));
  });

  it('allows newlines in the message but enforces the length limit', () => {
    expect(leadSchema.parse({ ...valid, message: 'Line one\nLine two' }).message).toBe(
      'Line one\nLine two',
    );
    expect(leadSchema.safeParse({ ...valid, message: 'x'.repeat(1001) }).success).toBe(false);
  });

  it('rejects an unknown intent', () => {
    expect(leadSchema.safeParse({ ...valid, intent: 'buy' }).success).toBe(false);
  });
});

describe('leadRequestSchema', () => {
  it('requires a turnstile token', () => {
    expect(leadRequestSchema.safeParse(valid).success).toBe(false);
    expect(leadRequestSchema.safeParse({ ...valid, turnstileToken: '' }).success).toBe(false);
    expect(leadRequestSchema.safeParse({ ...valid, turnstileToken: 'tok' }).success).toBe(true);
  });

  it('is still strict', () => {
    expect(leadRequestSchema.safeParse({ ...valid, turnstileToken: 'tok', extra: 1 }).success).toBe(
      false,
    );
  });
});
