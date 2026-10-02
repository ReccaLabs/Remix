import { describe, expect, it } from 'vitest';
import { isActivePath } from './nav';

describe('isActivePath', () => {
  it('matches a section home exactly', () => {
    expect(isActivePath('/app', '/app', true)).toBe(true);
    expect(isActivePath('/app/', '/app', true)).toBe(true);
    expect(isActivePath('/app/classes', '/app', true)).toBe(false);
  });

  it('matches a section and its sub-pages', () => {
    expect(isActivePath('/app/classes', '/app/classes')).toBe(true);
    expect(isActivePath('/app/classes/123', '/app/classes')).toBe(true);
    expect(isActivePath('/app/classesx', '/app/classes')).toBe(false);
    expect(isActivePath('/admin/students', '/app/classes')).toBe(false);
  });

  it('ignores the internal area prefix', () => {
    expect(isActivePath('/tenant/app/classes', '/app/classes')).toBe(true);
    expect(isActivePath('/tenant/admin', '/admin', true)).toBe(true);
  });

  it('is false without a pathname', () => {
    expect(isActivePath(null, '/app')).toBe(false);
  });
});
