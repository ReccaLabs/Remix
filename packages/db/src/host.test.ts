import { describe, expect, it } from 'vitest';
import { classifyHost, normaliseHost } from './host';

describe('normaliseHost', () => {
  it.each([
    ['kamalphysics.remix.lk', 'kamalphysics.remix.lk'],
    ['KamalPhysics.Remix.LK', 'kamalphysics.remix.lk'],
    ['  kamalphysics.remix.lk  ', 'kamalphysics.remix.lk'],
    ['kamalphysics.localhost:3001', 'kamalphysics.localhost'],
    ['kamalphysics.remix.lk.', 'kamalphysics.remix.lk'],
    ['kamalphysics.remix.lk.:443', 'kamalphysics.remix.lk'],
    ['xn--fsqu00a.example.lk', 'xn--fsqu00a.example.lk'],
    ['localhost', 'localhost'],
  ])('%s → %s', (raw, expected) => {
    expect(normaliseHost(raw)).toBe(expected);
  });

  it.each([
    '',
    ' ',
    '.',
    'kamal..remix.lk',
    '.remix.lk',
    '-kamal.remix.lk',
    'kamal-.remix.lk',
    'kamal_physics.remix.lk',
    'user@kamal.remix.lk',
    'kamal.remix.lk/path',
    'kamal.remix.lk:99999',
    'kamal.remix.lk:',
    'kamal.remix.lk:80:80',
    '[::1]:3000',
    '127.0.0.1',
    '127.0.0.1:4000',
    'ශ්‍රී.lk',
    `${'a'.repeat(64)}.remix.lk`,
    `${'a.'.repeat(130)}lk`,
    'x'.repeat(10_000),
  ])('rejects %j', (raw) => {
    expect(normaliseHost(raw)).toBeNull();
  });
});

describe('classifyHost', () => {
  const prod = ['remix.lk'];
  const dev = ['localhost'];

  it('maps exactly one label under a base domain to a slug', () => {
    expect(classifyHost('kamalphysics.remix.lk', prod)).toEqual({
      kind: 'slug',
      slug: 'kamalphysics',
      host: 'kamalphysics.remix.lk',
    });
    expect(classifyHost('Royal-Science.localhost:3001', dev)).toEqual({
      kind: 'slug',
      slug: 'royal-science',
      host: 'royal-science.localhost',
    });
  });

  it('never maps reserved or invalid slugs, the apex or deeper sub-domains', () => {
    for (const host of [
      'admin.remix.lk',
      'www.remix.lk',
      'api.remix.lk',
      'ab.remix.lk',
      'a--b.remix.lk',
      'remix.lk',
      'a.kamalphysics.remix.lk',
      'admin.localhost',
      'localhost',
    ]) {
      expect(classifyHost(host, [...prod, ...dev]), host).toBeNull();
    }
  });

  it('treats any other dotted host as a custom-domain lookup', () => {
    expect(classifyHost('Classes.KamalPhysics.lk', prod)).toEqual({
      kind: 'domain',
      host: 'classes.kamalphysics.lk',
    });
    // A look-alike that merely ends with the base domain's text is not under it.
    expect(classifyHost('evilremix.lk', prod)).toEqual({ kind: 'domain', host: 'evilremix.lk' });
  });

  it('returns null for single-label and malformed hosts', () => {
    expect(classifyHost('intranet', prod)).toBeNull();
    expect(classifyHost('kamal.remix.lk/x', prod)).toBeNull();
  });

  it('prefers the longest matching base domain', () => {
    expect(classifyHost('kamalphysics.staging.remix.lk', ['remix.lk', 'staging.remix.lk'])).toEqual(
      { kind: 'slug', slug: 'kamalphysics', host: 'kamalphysics.staging.remix.lk' },
    );
  });

  it('throws on a misconfigured base domain instead of guessing', () => {
    expect(() => classifyHost('kamal.remix.lk', ['remix.lk:443/'])).toThrow(TypeError);
  });
});
