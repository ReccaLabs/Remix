import { describe, expect, it } from 'vitest';
import { clientIpFromChain, normaliseHost, parseHost, resolveForwarded } from './forwarded';
import { parseTrustedProxies } from './trusted-proxy';

const trust = parseTrustedProxies('10.0.0.0/8');

describe('parseHost / normaliseHost', () => {
  it.each([
    ['Kamal.Remix.LK', 'kamal.remix.lk', null],
    ['kamal.remix.lk.', 'kamal.remix.lk', null],
    ['kamal.localhost:3001', 'kamal.localhost', 3001],
    ['xn--80ak6aa92e.com', 'xn--80ak6aa92e.com', null],
  ])('%s → %s', (input, hostname, port) => {
    expect(parseHost(input)).toEqual({ hostname, port });
  });

  it.each([
    undefined,
    '',
    '127.0.0.1',
    '10.0.0.1:4000',
    '[::1]:4000',
    'user@kamal.remix.lk',
    'kamal.remix.lk/path',
    'kamal.remix.lk, evil.remix.lk',
    'kamal_physics.remix.lk',
    '-kamal.remix.lk',
    'kаmal.remix.lk', // Cyrillic а
    'kamal.remix.lk:0',
    'kamal.remix.lk:65536',
    'a'.repeat(64) + '.lk',
  ])('rejects %s', (input) => {
    expect(parseHost(input)).toBeNull();
  });

  it('normaliseHost returns only the name', () => {
    expect(normaliseHost('Admin.Remix.lk:443')).toBe('admin.remix.lk');
  });
});

describe('resolveForwarded', () => {
  const headers = {
    host: 'api.internal:4000',
    'x-forwarded-host': 'kamal.remix.lk',
    'x-forwarded-proto': 'https',
    'x-forwarded-for': '203.0.113.7, 10.0.0.5',
  };

  it('honours X-Forwarded-* from a trusted peer', () => {
    expect(
      resolveForwarded({ headers, remoteAddress: '10.0.0.9', encrypted: false }, trust),
    ).toEqual({
      host: 'kamal.remix.lk',
      protocol: 'https',
      origin: 'https://kamal.remix.lk',
      clientIp: '203.0.113.7',
      viaTrustedProxy: true,
    });
  });

  it('ignores all three from an untrusted peer', () => {
    expect(
      resolveForwarded({ headers, remoteAddress: '198.51.100.1', encrypted: false }, trust),
    ).toEqual({
      host: 'api.internal',
      protocol: 'http',
      origin: 'http://api.internal:4000',
      clientIp: '198.51.100.1',
      viaTrustedProxy: false,
    });
  });

  it('rejects a forwarded host list instead of picking one', () => {
    const info = resolveForwarded(
      {
        headers: { ...headers, 'x-forwarded-host': 'evil.remix.lk, kamal.remix.lk' },
        remoteAddress: '10.0.0.9',
        encrypted: false,
      },
      trust,
    );
    expect(info.host).toBeNull();
    expect(info.origin).toBeNull();
  });

  it('falls back to Host when a trusted proxy sends no X-Forwarded-Host', () => {
    const info = resolveForwarded(
      { headers: { host: 'kamal.remix.lk' }, remoteAddress: '10.0.0.9', encrypted: true },
      trust,
    );
    expect(info).toMatchObject({
      host: 'kamal.remix.lk',
      protocol: 'https',
      origin: 'https://kamal.remix.lk',
    });
  });

  it('ignores an unknown forwarded scheme', () => {
    const info = resolveForwarded(
      {
        headers: { ...headers, 'x-forwarded-proto': 'https, http' },
        remoteAddress: '10.0.0.9',
        encrypted: false,
      },
      trust,
    );
    expect(info.protocol).toBe('http');
  });

  it('keeps a non-default port in the origin and drops a default one', () => {
    const at = (host: string, encrypted: boolean) =>
      resolveForwarded({ headers: { host }, remoteAddress: '198.51.100.1', encrypted }, trust)
        .origin;
    expect(at('kamal.localhost:3001', false)).toBe('http://kamal.localhost:3001');
    expect(at('kamal.remix.lk:443', true)).toBe('https://kamal.remix.lk');
    expect(at('kamal.remix.lk:80', false)).toBe('http://kamal.remix.lk');
  });
});

describe('clientIpFromChain', () => {
  it('returns the first untrusted address from the right', () => {
    expect(clientIpFromChain('10.0.0.1', ['1.1.1.1', '203.0.113.7', '10.0.0.2'], trust)).toBe(
      '203.0.113.7',
    );
  });

  it('returns the peer itself when it is untrusted', () => {
    expect(clientIpFromChain('198.51.100.1', ['1.1.1.1'], trust)).toBe('198.51.100.1');
  });

  it('returns the furthest trusted hop when everything is trusted', () => {
    expect(clientIpFromChain('10.0.0.1', ['10.0.0.2'], trust)).toBe('10.0.0.2');
  });

  it('stops at garbage in the chain', () => {
    expect(clientIpFromChain('10.0.0.1', ['203.0.113.7', 'not-an-ip'], trust)).toBe('10.0.0.1');
  });

  it('unwraps IPv4-mapped addresses', () => {
    expect(clientIpFromChain('::ffff:198.51.100.1', [], trust)).toBe('198.51.100.1');
  });
});
