import { describe, expect, it } from 'vitest';
import { can, isClassScoped, PERMISSIONS, ROLE_PERMISSIONS } from './permissions';

describe('permissions', () => {
  it('gives the owner everything', () => {
    for (const p of PERMISSIONS) expect(can(['owner'], p)).toBe(true);
  });

  it('keeps staff and settings management with the owner only', () => {
    for (const role of ['admin', 'teacher', 'cashier', 'gatekeeper'] as const) {
      expect(can([role], 'staff.manage')).toBe(false);
      expect(can([role], 'settings.manage')).toBe(false);
    }
  });

  it('denies by default (no roles → nothing)', () => {
    for (const p of PERMISSIONS) expect(can([], p)).toBe(false);
  });

  it('lets teachers read but not write', () => {
    expect(can(['teacher'], 'classes.read')).toBe(true);
    expect(can(['teacher'], 'classes.write')).toBe(false);
    expect(can(['teacher'], 'students.write')).toBe(false);
  });

  it('combines roles', () => {
    expect(can(['teacher', 'admin'], 'classes.write')).toBe(true);
  });

  it('scopes only pure teachers to their classes', () => {
    expect(isClassScoped(['teacher'])).toBe(true);
    expect(isClassScoped(['teacher', 'admin'])).toBe(false);
    expect(isClassScoped([])).toBe(false);
  });

  it('only lists known permissions', () => {
    for (const list of Object.values(ROLE_PERMISSIONS)) {
      for (const p of list) expect(PERMISSIONS).toContain(p);
    }
  });
});
