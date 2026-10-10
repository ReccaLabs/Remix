import { describe, expect, it } from 'vitest';
import { buildCsp, createNonce, securityHeaders } from './security-headers';

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split(';').map((part) => {
      const [name = '', ...values] = part.trim().split(/\s+/);
      return [name, values] as const;
    }),
  );
}

describe('createNonce', () => {
  it('is 128-bit base64 and unique per call', () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(a).not.toBe(b);
  });
});

describe('buildCsp (production)', () => {
  const nonce = 'abc123XYZ+/=';
  const csp = buildCsp({ nonce, isDev: false });
  const d = directives(csp);

  it('allows scripts only by nonce with strict-dynamic', () => {
    expect(d.get('script-src')).toEqual(["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]);
  });

  it('requires the nonce for style elements', () => {
    expect(d.get('style-src')).toContain(`'nonce-${nonce}'`);
    expect(d.get('style-src')).not.toContain("'unsafe-inline'");
  });

  it('never allows eval, inline scripts or wildcards', () => {
    expect(csp).not.toContain('unsafe-eval');
    expect(d.get('script-src')).not.toContain("'unsafe-inline'");
    expect(csp).not.toMatch(/(^|\s)\*/);
    // Scheme sources (https:, wss:) are not allowed anywhere except img-src (see below).
    for (const [name, values] of d) {
      if (name === 'img-src') continue;
      expect(
        values.filter((v) => /^(?:https?|wss?):$/.test(v)),
        name,
      ).toEqual([]);
    }
  });

  it('images may come from https hosts (institute logo and tab icon, TEN-03), never plain http', () => {
    expect(d.get('img-src')).toEqual(["'self'", 'data:', 'blob:', 'https:']);
    expect(d.get('img-src')).not.toContain('http:');
  });

  it('locks down plugins, base, framing, forms and connections', () => {
    expect(d.get('object-src')).toEqual(["'none'"]);
    expect(d.get('base-uri')).toEqual(["'none'"]);
    expect(d.get('frame-ancestors')).toEqual(["'none'"]);
    expect(d.get('form-action')).toEqual(["'self'"]);
    expect(d.get('connect-src')).toEqual(["'self'"]);
    expect(d.get('default-src')).toEqual(["'self'"]);
    expect(d.has('upgrade-insecure-requests')).toBe(true);
  });
});

describe('buildCsp storage origin (ADR 0009)', () => {
  it('adds exactly the configured storage origin to connect-src and img-src, nothing else', () => {
    const d = directives(buildCsp({ nonce: 'n', isDev: false, storageOrigin: 'https://acct.r2.cloudflarestorage.com' }));
    expect(d.get('connect-src')).toEqual(["'self'", 'https://acct.r2.cloudflarestorage.com']);
    expect(d.get('img-src')).toContain('https://acct.r2.cloudflarestorage.com');
    expect(d.get('form-action')).toEqual(["'self'"]);
    expect(d.get('default-src')).toEqual(["'self'"]);
    expect(directives(buildCsp({ nonce: 'n', isDev: false })).get('connect-src')).toEqual(["'self'"]);
  });
});

describe('buildCsp (development)', () => {
  it('permits only the exact PayHere actions when the Payments page opts in', () => {
    const policy = buildCsp({ nonce: 'sample', isDev: false, allowPayhereCheckout: true });
    expect(policy).toContain(
      "form-action 'self' https://sandbox.payhere.lk/pay/checkout https://www.payhere.lk/pay/checkout",
    );
    expect(policy).toContain("connect-src 'self'");
  });
  it('adds only what next dev needs', () => {
    const d = directives(buildCsp({ nonce: 'n', isDev: true }));
    expect(d.get('script-src')).toEqual([
      "'self'",
      "'nonce-n'",
      "'strict-dynamic'",
      "'unsafe-eval'",
    ]);
    expect(d.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d.has('upgrade-insecure-requests')).toBe(false);
  });
});

describe('securityHeaders', () => {
  it('sets the baseline headers', () => {
    const h = securityHeaders({ nonce: 'n', isDev: false, hsts: true });
    expect(h['Content-Security-Policy']).toContain("'nonce-n'");
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(h['Permissions-Policy']).toContain('camera=()');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Strict-Transport-Security']).toBe('max-age=31536000');
  });

  it('omits HSTS outside production', () => {
    const h = securityHeaders({ nonce: 'n', isDev: true, hsts: false });
    expect(h['Strict-Transport-Security']).toBeUndefined();
  });
  it('allows only same-origin camera when explicitly enabled, keeping microphone and USB denied', () => {
    const headers = securityHeaders({ nonce: 'n', isDev: false, hsts: true, allowCamera: true });
    expect(headers['Permissions-Policy']).toContain('camera=(self)');
    expect(headers['Permissions-Policy']).toContain('microphone=()');
    expect(headers['Permissions-Policy']).toContain('usb=()');
    expect(headers['Content-Security-Policy']).toBe(buildCsp({ nonce: 'n', isDev: false }));
  });
});
