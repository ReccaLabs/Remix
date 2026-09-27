import { describe, expect, it } from 'vitest';
import { parseClassAddress } from './find-class';

const ok = (slug: string) => ({ ok: true, slug, url: `https://${slug}.remix.lk/` });

describe('parseClassAddress', () => {
  it.each([
    ['kamalphysics', 'kamalphysics'],
    ['  KamalPhysics  ', 'kamalphysics'],
    ['kamalphysics.remix.lk', 'kamalphysics'],
    ['kamalphysics.remix.lk.', 'kamalphysics'],
    ['https://kamalphysics.remix.lk', 'kamalphysics'],
    ['http://kamalphysics.remix.lk/login?next=/app#top', 'kamalphysics'],
    ['kamal-physics-2026', 'kamal-physics-2026'],
    ['a', 'a'],
    ['abc', 'abc'],
    ['a'.repeat(63), 'a'.repeat(63)],
  ])('accepts %j', (input, slug) => {
    expect(parseClassAddress(input)).toEqual(ok(slug));
  });

  it('rejects empty input', () => {
    expect(parseClassAddress('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it.each([
    'www',
    'admin',
    'API',
    'app.remix.lk',
    'mail',
    'staging',
    'remix.lk',
    'www.remix.lk',
    'https://remix.lk/kamalphysics',
  ])('rejects reserved %j', (input) => {
    expect(parseClassAddress(input)).toEqual({ ok: false, reason: 'reserved' });
  });

  it.each([
    'evil.com',
    'kamalphysics.lk',
    'https://evil.com/kamalphysics.remix.lk',
    'remix.lk.evil.com',
  ])('never leaves remix.lk: %j is another domain', (input) => {
    expect(parseClassAddress(input)).toEqual({ ok: false, reason: 'otherDomain' });
  });

  it.each([
    'kamalphysics.remix.lk@evil.com',
    'evil.com@kamalphysics.remix.lk',
    'kamalphysics.remix.lk:8080',
    'javascript:alert(1)',
    'kamal physics',
    '-kamal',
    'kamal-',
    'ab',
    'a'.repeat(64),
    'a.b.remix.lk',
    'xn--80ak6aa92e',
    'kamal_physics',
    'කමල්',
    '//evil.com',
    '\\\\evil.com',
    'kamal%2e.remix.lk',
  ])('rejects invalid %j', (input) => {
    const result = parseClassAddress(input);
    expect(result.ok).toBe(false);
  });

  it('only ever produces https://<label>.remix.lk/ URLs', () => {
    const samples = [
      'x',
      'kamalphysics',
      'https://abc.remix.lk/x',
      'evil.com',
      'a@b',
      '//x',
      'x.remix.lk',
    ];
    for (const s of samples) {
      const r = parseClassAddress(s);
      if (r.ok) {
        const url = new URL(r.url);
        expect(url.protocol).toBe('https:');
        expect(url.hostname).toBe(`${r.slug}.remix.lk`);
        expect(url.pathname).toBe('/');
        expect(url.username + url.password + url.search + url.hash).toBe('');
      }
    }
  });
});
