import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import type { Db } from './client';
import { resetOwnerPassword, resetOwnerPasswordInputSchema } from './provision';

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
