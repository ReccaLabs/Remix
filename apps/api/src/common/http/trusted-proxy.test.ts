import { describe, expect, it } from 'vitest';
import { parseTrustedProxies, unmapIPv4 } from './trusted-proxy';

describe('parseTrustedProxies', () => {
  it('expands keywords', () => {
    const trust = parseTrustedProxies('loopback, uniquelocal, linklocal');
    for (const ip of [
      '127.0.0.1',
      '127.9.9.9',
      '::1',
      '10.4.0.2',
      '172.16.5.5',
      '192.168.1.1',
      'fd00::1',
      '169.254.1.1',
      'fe80::1',
    ]) {
      expect(trust.isTrusted(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '2001:db8::1'])
      expect(trust.isTrusted(ip), ip).toBe(false);
  });

  it('accepts single addresses and CIDRs, v4 and v6', () => {
    const trust = parseTrustedProxies('203.0.113.10, 198.51.100.0/24, 2001:db8::/32');
    expect(trust.isTrusted('203.0.113.10')).toBe(true);
    expect(trust.isTrusted('203.0.113.11')).toBe(false);
    expect(trust.isTrusted('198.51.100.200')).toBe(true);
    expect(trust.isTrusted('2001:db8:1::5')).toBe(true);
  });

  it('matches IPv4-mapped IPv6 peers (dual-stack sockets)', () => {
    expect(parseTrustedProxies('loopback').isTrusted('::ffff:127.0.0.1')).toBe(true);
  });

  it('trusts nobody with `none` or an empty list', () => {
    expect(parseTrustedProxies('none').isTrusted('127.0.0.1')).toBe(false);
    expect(parseTrustedProxies('').isTrusted('127.0.0.1')).toBe(false);
  });

  it('never trusts a missing or non-IP peer', () => {
    const trust = parseTrustedProxies('loopback');
    expect(trust.isTrusted(undefined)).toBe(false);
    expect(trust.isTrusted('localhost')).toBe(false);
  });

  it.each(['true', '*', 'cloudflare', '10.0.0.0/33', '10.0.0.0/x', '::1/129', '300.1.1.1'])(
    'rejects %s',
    (value) => {
      expect(() => parseTrustedProxies(value)).toThrow();
    },
  );
});

describe('unmapIPv4', () => {
  it('unwraps only IPv4-mapped addresses', () => {
    expect(unmapIPv4('::ffff:10.0.0.1')).toBe('10.0.0.1');
    expect(unmapIPv4('::1')).toBe('::1');
    expect(unmapIPv4('10.0.0.1')).toBe('10.0.0.1');
  });
});
