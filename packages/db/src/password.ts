import { randomBytes } from 'node:crypto';
import { hash, type Algorithm, type Options } from '@node-rs/argon2';

/**
 * Argon2id with the OWASP parameters from ADR 0004 (m = 19456 KiB, t = 2, p = 1). Used here by
 * the seed and the tenant:create CLI; the API's auth module must use the same parameters.
 * `algorithm: 2` is Argon2id — the binding ships it as an ambient const enum, which isolated
 * modules cannot reference by name.
 */
export const ARGON2ID_OPTIONS: Options = {
  algorithm: 2 satisfies Algorithm,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2ID_OPTIONS);
}

/** 144 random bits as 24 base64url characters — a one-time password shown once. */
export function temporaryPassword(): string {
  return randomBytes(18).toString('base64url');
}
