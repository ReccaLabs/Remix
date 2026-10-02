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
    expect(csp).not.toMatch(/(^|\s)(https?:|wss?:)(\s|;|$)/);
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

describe('buildCsp (development)', () => {
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
});
