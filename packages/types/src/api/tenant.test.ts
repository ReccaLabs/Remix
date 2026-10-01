import { describe, expect, it } from 'vitest';
import { brandColorSchema, TENANT_STATUSES, tenantAccess, tenantSlugSchema } from './tenant';

describe('tenantSlugSchema', () => {
  it.each(['kamalphysics', 'abc', 'royal-science-2026', 'KamalPhysics'])('accepts %s', (slug) => {
    expect(tenantSlugSchema.parse(slug)).toBe(slug.toLowerCase());
  });

  it.each([
    ['too short', 'ab'],
    ['too long', 'a'.repeat(41)],
    ['leading hyphen', '-kamal'],
    ['trailing hyphen', 'kamal-'],
    ['double hyphen', 'kamal--physics'],
    ['dot (would nest a sub-domain)', 'kamal.physics'],
    ['underscore', 'kamal_physics'],
    ['non-ASCII look-alike', 'kаmal'],
    ['reserved: admin', 'admin'],
    ['reserved: api', 'api'],
    ['reserved: www', 'www'],
  ])('rejects %s', (_label, slug) => {
    expect(tenantSlugSchema.safeParse(slug).success).toBe(false);
  });
});

describe('brandColorSchema', () => {
  it('accepts #rrggbb', () => {
    expect(brandColorSchema.parse('#0E7C66')).toBe('#0E7C66');
  });

  it.each(['red', '#fff', '#0E7C66; background:url(x)', 'var(--x)', '#0E7C6'])(
    'rejects %s (would be injected into CSS)',
    (value) => {
      expect(brandColorSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('tenantAccess (TEN-06)', () => {
  it.each(['trial', 'active', 'past_due'] as const)('%s → everything works', (status) => {
    expect(tenantAccess(status)).toEqual({ publicSite: true, studentPortal: true, staff: 'full' });
  });

  it('suspended → site and portal off, staff see billing only', () => {
    expect(tenantAccess('suspended')).toEqual({
      publicSite: false,
      studentPortal: false,
      staff: 'billing-only',
    });
  });

  it('cancelled → nothing', () => {
    expect(tenantAccess('cancelled')).toEqual({
      publicSite: false,
      studentPortal: false,
      staff: 'none',
    });
  });

  it('covers every status', () => {
    for (const status of TENANT_STATUSES) expect(tenantAccess(status)).toBeDefined();
  });
});
