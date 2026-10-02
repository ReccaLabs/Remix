import { describe, expect, it } from 'vitest';
import { loginRedirect, safeNextPath } from './safe-next';

describe('safeNextPath', () => {
  it('keeps same-host paths with their query and hash', () => {
    expect(safeNextPath('/app')).toBe('/app');
    expect(safeNextPath('/app/classes?tab=1#top')).toBe('/app/classes?tab=1#top');
    expect(safeNextPath('/')).toBe('/');
  });

  it('rejects protocol-relative and backslash tricks', () => {
    for (const raw of [
      '//evil.example',
      '//evil.example/app',
      '/\\evil.example',
      '\\\\evil.example',
      '/app\\..\\..\\evil',
      '///evil.example',
    ]) {
      expect(safeNextPath(raw), raw).toBeNull();
    }
  });

  it('rejects absolute URLs and anything not starting with a single slash', () => {
    for (const raw of [
      'https://evil.example/app',
      'http:/evil.example',
      'javascript:alert(1)',
      'data:text/html,hi',
      'app/classes',
      ' /app',
      '',
      '?next=/app',
    ]) {
      expect(safeNextPath(raw), raw).toBeNull();
    }
  });

  it('rejects control characters browsers would strip into //evil', () => {
    expect(safeNextPath('/\t/evil.example')).toBeNull();
    expect(safeNextPath('/\n/evil.example')).toBeNull();
    expect(safeNextPath('/\r/evil.example')).toBeNull();
    expect(safeNextPath('/app classes')).toBeNull();
    expect(safeNextPath('/\u0000')).toBeNull();
  });

  it('rejects non-strings and absurd lengths', () => {
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(['/app'])).toBeNull();
    expect(safeNextPath(`/${'a'.repeat(3000)}`)).toBeNull();
  });

  it('confines the target to a section after normalising dot segments', () => {
    expect(safeNextPath('/app/classes', '/app')).toBe('/app/classes');
    expect(safeNextPath('/app', '/app')).toBe('/app');
    expect(safeNextPath('/application', '/app')).toBeNull();
    expect(safeNextPath('/admin', '/app')).toBeNull();
    expect(safeNextPath('/app/../admin', '/app')).toBeNull();
    expect(safeNextPath('/app/%2e%2e/admin', '/app')).toBeNull();
  });
});

describe('loginRedirect', () => {
  it('adds an encoded next for a safe path', () => {
    expect(loginRedirect('/login', '/app/classes?x=1', '/app')).toBe(
      '/login?next=%2Fapp%2Fclasses%3Fx%3D1',
    );
  });

  it('falls back to the bare login path', () => {
    expect(loginRedirect('/login', null)).toBe('/login');
    expect(loginRedirect('/login', '//evil.example')).toBe('/login');
    expect(loginRedirect('/admin/login', '/app', '/admin')).toBe('/admin/login');
    expect(loginRedirect('/login', '/app', '/app')).toBe('/login');
  });
});
