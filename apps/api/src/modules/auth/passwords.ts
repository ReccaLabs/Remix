import { randomBytes } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { parseOptions, verify } from '@node-rs/argon2';
import { ARGON2ID_OPTIONS, hashPassword } from '@remix/db';

/**
 * Argon2id verification with the shared parameters (ADR 0004, `ARGON2ID_OPTIONS` in
 * `@remix/db`). A dummy hash is computed at boot from a random secret nobody knows, so a login
 * for an unknown user costs the same Argon2id work as a wrong password (no user enumeration by
 * timing).
 */
@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash: string | undefined;

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hashPassword(randomBytes(32).toString('base64url'));
  }

  /** True only when `hash` is a valid Argon2 PHC string that matches `password`. */
  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await verify(hash, password);
    } catch {
      // A malformed stored hash is a failed login, never a 500 that reveals the account exists.
      return false;
    }
  }

  /** Burn the same Argon2id work as a real verify; always false. */
  async verifyDummy(password: string): Promise<false> {
    if (!this.dummyHash) throw new Error('PasswordService used before module init');
    await this.verify(this.dummyHash, password);
    return false;
  }

  /** The stored hash was made with other parameters than today's policy → re-hash on login. */
  needsRehash(hash: string): boolean {
    try {
      const o = parseOptions(hash);
      return (
        o.algorithm !== ARGON2ID_OPTIONS.algorithm ||
        o.memoryCost !== ARGON2ID_OPTIONS.memoryCost ||
        o.timeCost !== ARGON2ID_OPTIONS.timeCost ||
        o.parallelism !== ARGON2ID_OPTIONS.parallelism
      );
    } catch {
      return false;
    }
  }

  hash(password: string): Promise<string> {
    return hashPassword(password);
  }
}
