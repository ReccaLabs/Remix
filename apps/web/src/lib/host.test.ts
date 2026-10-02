import { describe, expect, it } from 'vitest';
import { classifyHost, normalizeHost, type HostConfig } from './host';

const prod: HostConfig = { tenantBaseDomains: ['remix.lk'], platformHosts: ['admin.remix.lk'] };
const dev: HostConfig = { tenantBaseDomains: ['localhost'], platformHosts: ['admin.localhost'] };

describe('normalizeHost', () => {
  it('lower-cases, strips the port and one trailing dot', () => {
    expect(normalizeHost('KamalPhysics.Remix.LK')).toBe('kamalphysics.remix.lk');
    expect(normalizeHost('kamalphysics.localhost:3001')).toBe('kamalphysics.localhost');
    expect(normalizeHost('kamalphysics.remix.lk.')).toBe('kamalphysics.remix.lk');
    expect(normalizeHost('kamalphysics.remix.lk.:443')).toBe('kamalphysics.remix.lk');
    expect(normalizeHost('  classes.example.com  ')).toBe('classes.example.com');
  });

  it('accepts punycode labels', () => {
    expect(normalizeHost('xn--fsq.example.com')).toBe('xn--fsq.example.com');
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['   '],
    ['.'],
    ['..'],
    ['a..remix.lk'],
    ['-bad.remix.lk'],
    ['bad-.remix.lk'],
    ['under_score.remix.lk'],
    ['kamal physics.remix.lk'],
    ['user@kamalphysics.remix.lk'],
    ['kamalphysics.remix.lk/path'],
    ['kamalphysics.remix.lk:'],
    ['kamalphysics.remix.lk:abc'],
    ['kamalphysics.remix.lk:3001:3002'],
    ['127.0.0.1'],
    ['127.0.0.1:3001'],
    ['10.1'],
    ['[::1]'],
    ['[::1]:3001'],
    ['::1'],
    [`${'a'.repeat(64)}.remix.lk`],
    [`${'a.'.repeat(130)}lk`],
    ['%6Bamal.remix.lk'],
  ])('rejects malformed host %j', (raw) => {
    expect(normalizeHost(raw)).toBeNull();
  });
});

describe('classifyHost', () => {
  it('routes the platform host to the platform area', () => {
    expect(classifyHost('admin.remix.lk', prod)).toEqual({ area: 'platform' });
    expect(classifyHost('ADMIN.REMIX.LK:443', prod)).toEqual({ area: 'platform' });
    expect(classifyHost('admin.localhost:3001', dev)).toEqual({ area: 'platform' });
  });

  it('routes a single-label sub-domain of a base domain to the tenant area', () => {
    expect(classifyHost('kamalphysics.remix.lk', prod)).toEqual({
      area: 'tenant',
      host: 'kamalphysics.remix.lk',
    });
    expect(classifyHost('KamalPhysics.localhost:3001', dev)).toEqual({
      area: 'tenant',
      host: 'kamalphysics.localhost',
    });
    expect(classifyHost('kamalphysics.remix.lk.', prod)).toEqual({
      area: 'tenant',
      host: 'kamalphysics.remix.lk',
    });
  });

  it('treats the bare base domain as unknown (it is the marketing site, or nothing)', () => {
    expect(classifyHost('remix.lk', prod)).toEqual({ area: 'unknown' });
    expect(classifyHost('localhost:3001', dev)).toEqual({ area: 'unknown' });
  });

  it('rejects nested and reserved sub-domains of a base domain', () => {
    expect(classifyHost('a.kamalphysics.remix.lk', prod)).toEqual({ area: 'unknown' });
    expect(classifyHost('www.remix.lk', prod)).toEqual({ area: 'unknown' });
    expect(classifyHost('api.remix.lk', prod)).toEqual({ area: 'unknown' });
    // `admin` is only the platform when it is a configured platform host.
    const otherPlatform = { ...prod, platformHosts: ['ops.remix.lk'] };
    expect(classifyHost('admin.remix.lk', otherPlatform)).toEqual({ area: 'unknown' });
  });

  it('passes other multi-label hosts through as possible custom domains (the API decides)', () => {
    expect(classifyHost('classes.kamal.lk', prod)).toEqual({
      area: 'tenant',
      host: 'classes.kamal.lk',
    });
  });

  it('never reads a look-alike as a base-domain tenant', () => {
    // Not `evil` under remix.lk: the whole host goes to the API as a custom-domain candidate,
    // where it only resolves if attacker.com's owner verified it as their own institute domain.
    const result = classifyHost('evil.remix.lk.attacker.com', prod);
    expect(result).toEqual({ area: 'tenant', host: 'evil.remix.lk.attacker.com' });
    expect(classifyHost('admin.remix.lk.attacker.com', prod)).not.toEqual({ area: 'platform' });
    expect(classifyHost('evilremix.lk', prod)).toEqual({ area: 'tenant', host: 'evilremix.lk' });
  });

  it('treats IP literals, single-label names, empty and garbage hosts as unknown', () => {
    for (const host of [
      '127.0.0.1',
      '127.0.0.1:3001',
      '[::1]:3001',
      '203.0.113.7',
      'intranet',
      '',
      null,
      undefined,
      '%%%',
      'kamalphysics.remix.lk/x',
      'a b',
    ]) {
      expect(classifyHost(host, prod)).toEqual({ area: 'unknown' });
    }
  });

  it('supports several base domains and platform hosts', () => {
    const multi: HostConfig = {
      tenantBaseDomains: ['remix.lk', 'staging.remix.lk'],
      platformHosts: ['admin.remix.lk', 'admin.staging.remix.lk'],
    };
    expect(classifyHost('admin.staging.remix.lk', multi)).toEqual({ area: 'platform' });
    expect(classifyHost('kamal.staging.remix.lk', multi)).toEqual({
      area: 'tenant',
      host: 'kamal.staging.remix.lk',
    });
  });
});
