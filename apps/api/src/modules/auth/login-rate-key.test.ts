import { describe, expect, it } from 'vitest';
import { INVALID_LOGIN_KEY, loginIdentifierKey } from './login.service';

const PHONE = '+94771234567';

describe('loginIdentifierKey (S-01)', () => {
  it('gives every format of one phone the same key, on both endpoints', () => {
    const forms = ['+94771234567', '0771234567', '077 123 4567', ' 94771234567 '];
    for (const phone of forms) {
      expect(loginIdentifierKey('student', { phone, password: 'x' })).toBe(`phone:${PHONE}`);
      expect(loginIdentifierKey('staff', { identifier: phone, password: 'x' })).toBe(
        `phone:${PHONE}`,
      );
    }
  });

  it('is not fooled by padding: the schema trims before it checks length', () => {
    const padded = `${PHONE}${' '.repeat(260)}`;
    expect(padded.length).toBeGreaterThan(254);
    // Both schemas trim before they check the length, so the padded value really logs in …
    expect(loginIdentifierKey('student', { phone: padded, password: 'x' })).toBe(`phone:${PHONE}`);
    expect(loginIdentifierKey('staff', { identifier: padded, password: 'x' })).toBe(
      `phone:${PHONE}`,
    );
    const email = `Owner@Example.test${' '.repeat(260)}`;
    expect(loginIdentifierKey('staff', { identifier: email, password: 'x' })).toBe(
      'email:owner@example.test',
    );
  });

  it('puts a body that does not parse into one fixed bucket — never null', () => {
    const bodies: unknown[] = [
      undefined,
      null,
      'text',
      [],
      {},
      { identifier: 'x'.repeat(400), password: 'x' },
      { identifier: 'a@b.test' }, // no password
      { identifier: 'a@b.test', password: 'x', extra: 1 }, // strictObject
      { identifier: { toString: () => 'a@b.test' }, password: 'x' },
    ];
    for (const body of bodies) {
      expect(loginIdentifierKey('staff', body)).toBe(INVALID_LOGIN_KEY);
      expect(loginIdentifierKey('student', body)).toBe(INVALID_LOGIN_KEY);
    }
  });

  it('keys an identifier that is neither phone nor email by its lower-cased trimmed value', () => {
    expect(loginIdentifierKey('staff', { identifier: '  Kamal  ', password: 'x' })).toBe(
      'raw:kamal',
    );
  });
});
