import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { OTP_RULES } from '@remix/types/api';

/**
 * SMS one-time codes (ADR 0004 addendum). A 6-digit code has ~20 bits of entropy, so a plain
 * hash in a database dump could be reversed in milliseconds; the stored value is therefore an
 * HMAC under a dedicated server secret (`AUTH_CODE_SECRET`), which makes offline guessing
 * impossible without the key. Every comparison is constant-time.
 */

/** A fresh code: `OTP_RULES.length` digits from the CSPRNG, leading zeros kept. */
export function newOtpCode(): string {
  return String(randomInt(0, 10 ** OTP_RULES.length)).padStart(OTP_RULES.length, '0');
}

/** What a code is bound to: a code for one tenant/phone/purpose is useless for any other. */
export type CodeBinding = readonly [tenantId: string, subject: string, purpose: string];

/**
 * HMAC-SHA-256 (hex) of `tenantId | subject | purpose | code`. `subject` is the phone for
 * `otp_challenges` and the user id for two-step codes. The parts never contain `|`
 * (UUIDs, E.164 numbers, enum values, digits), so the encoding is unambiguous.
 */
export function hashCode(secret: string, binding: CodeBinding, code: string): string {
  return createHmac('sha256', secret)
    .update([...binding, code].join('|'), 'utf8')
    .digest('hex');
}

/**
 * Constant-time equality of two hex digests. Different lengths (a malformed stored value) are
 * simply unequal; the length itself is not secret.
 */
export function digestsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** `+94771234567` → `+94 77 *** **67` (shown on the two-step screen; never the full number). */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/^\+94/, '');
  if (!/^\d{9}$/.test(digits)) return '***';
  return `+94 ${digits.slice(0, 2)} *** **${digits.slice(-2)}`;
}
