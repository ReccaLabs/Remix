import { describe, expect, it } from 'vitest';
import { clientIpKey } from './client-ip-key';

describe('clientIpKey (S-03)', () => {
  it('leaves IPv4 alone', () => {
    expect(clientIpKey('203.0.113.7')).toBe('203.0.113.7');
  });

  it('turns IPv4-mapped IPv6 into the IPv4 address, in either notation', () => {
    expect(clientIpKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientIpKey('::FFFF:cb00:7107')).toBe('203.0.113.7');
    expect(clientIpKey('0:0:0:0:0:ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientIpKey('::ffff:0:0')).toBe('0.0.0.0');
  });

  it('keys an IPv6 address by its /64, however it is written', () => {
    const key = clientIpKey('2001:db8:85a3:1::1');
    expect(key).toBe('2001:db8:85a3:1::/64');
    expect(clientIpKey('2001:0db8:85a3:0001:0000:0000:0000:0001')).toBe(key);
    expect(clientIpKey('2001:DB8:85A3:1:0:0:0:1')).toBe(key);
    expect(clientIpKey('2001:db8:85a3:1:abcd:ef01:2345:6789')).toBe(key);
    expect(clientIpKey('2001:db8:85a3:1:ffff:ffff:ffff:ffff')).toBe(key);
  });

  it('gives addresses in the same /64 the same key and different /64s different keys', () => {
    expect(clientIpKey('2001:db8:1:2::1')).toBe(clientIpKey('2001:db8:1:2:9:8:7:6'));
    expect(clientIpKey('2001:db8:1:2::1')).not.toBe(clientIpKey('2001:db8:1:3::1'));
    expect(clientIpKey('2001:db8:1:2::1')).not.toBe(clientIpKey('2001:db8:2:2::1'));
    expect(clientIpKey('2001:db8:1:2::1')).not.toBe(clientIpKey('2001:db9:1:2::1'));
  });

  it('handles `::` at the start, middle and end', () => {
    expect(clientIpKey('::1')).toBe('0:0:0:0::/64');
    expect(clientIpKey('::')).toBe('0:0:0:0::/64');
    expect(clientIpKey('fe80::1')).toBe('fe80:0:0:0::/64');
    expect(clientIpKey('2001:db8::')).toBe('2001:db8:0:0::/64');
    expect(clientIpKey('2001:db8::5:6:7:8')).toBe('2001:db8:0:0::/64');
    expect(clientIpKey('1:2:3:4::')).toBe('1:2:3:4::/64');
    expect(clientIpKey('1:2:3:4:5:6:7::')).toBe('1:2:3:4::/64');
    expect(clientIpKey('::2:3:4:5:6:7:8')).toBe('0:2:3:4::/64');
  });

  it('ignores a zone id and does not confuse a mapped-looking prefix with the real thing', () => {
    expect(clientIpKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    // ::ffff:1.2.3.4 is mapped; 1::ffff:... is an ordinary global address.
    expect(clientIpKey('1::ffff:1.2.3.4')).toBe('1:0:0:0::/64');
    expect(clientIpKey('::1:ffff:1.2.3.4')).toBe('0:0:0:0::/64'); // g4 = 1, not mapped
  });

  it('returns a non-address unchanged', () => {
    expect(clientIpKey('unknown')).toBe('unknown');
  });
});
