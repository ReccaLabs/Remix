import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import type { Db } from './client';
import {
  createTenantInputSchema,
  defaultPrefix,
  studentPrefixCandidates,
  resetOwnerPassword,
  resetOwnerPasswordInputSchema,
} from './provision';

describe('STU-07 prefix selection', () => {
  it('uses padded English initials with a valid fallback', () => {
    expect(defaultPrefix('Nilanka Institute')).toBe('NIL');
    expect(defaultPrefix('royal science classes')).toBe('RSC');
    expect(defaultPrefix('Nilanka')).toBe('NIL');
    for (const name of ['A', 'ශ්‍රී', 'École', 'A B C D E'])
      expect(defaultPrefix(name)).toMatch(/^[A-Z]{2,4}$/);
  });
  it('tries collision alternatives deterministically', () => {
    const candidates = studentPrefixCandidates('Nilanka Institute');
    expect([candidates.next().value, candidates.next().value, candidates.next().value]).toEqual([
      'NIL',
      'NILA',
      'NLI',
    ]);
  });
  it('validates the CLI explicit prefix', () => {
    const base = {
      slug: 'nilanka',
      name: 'Nilanka Institute',
      plan: 'institute',
      ownerPhone: '0771234567',
      ownerName: 'Owner',
    };
    expect(createTenantInputSchema.parse({ ...base, studentNoPrefix: 'br' }).studentNoPrefix).toBe(
      'BR',
    );
    for (const studentNoPrefix of ['A', 'ABCDE', 'N1', 'ශ්‍රී'])
      expect(createTenantInputSchema.safeParse({ ...base, studentNoPrefix }).success).toBe(false);
  });
});

/** A database that fails the test if anything touches it. */
const untouchable = new Proxy(
  {},
  {
    get() {
      throw new Error('the database must not be touched for invalid input');
    },
  },
) as Db;

describe('resetOwnerPasswordInputSchema (tenant:reset-owner-password)', () => {
  it('accepts a slug, and an optional phone in any local format', () => {
    expect(resetOwnerPasswordInputSchema.parse({ slug: 'kamalphysics' })).toEqual({
      slug: 'kamalphysics',
    });
    expect(
      resetOwnerPasswordInputSchema.parse({ slug: 'kamalphysics', ownerPhone: '077 123 4567' }),
    ).toEqual({ slug: 'kamalphysics', ownerPhone: '+94771234567' });
  });

  it('rejects reserved or malformed slugs, landlines and unknown fields', () => {
    for (const slug of ['admin', 'www', 'Bad Slug', 'a--b', 'ab', '']) {
      expect(resetOwnerPasswordInputSchema.safeParse({ slug }).success).toBe(false);
    }
    expect(
      resetOwnerPasswordInputSchema.safeParse({ slug: 'kamalphysics', ownerPhone: '0112345678' })
        .success,
    ).toBe(false);
    expect(
      resetOwnerPasswordInputSchema.safeParse({ slug: 'kamalphysics', password: 'x' }).success,
    ).toBe(false);
  });
});

describe('resetOwnerPassword input handling', () => {
  it('validates before it touches the database', async () => {
    await expect(resetOwnerPassword(untouchable, { slug: 'Bad Slug' })).rejects.toBeInstanceOf(
      ZodError,
    );
  });
});
