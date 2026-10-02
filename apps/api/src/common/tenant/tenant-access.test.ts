import { describe, expect, it } from 'vitest';
import { sessionAllowed } from './tenant-access.guard';

describe('sessionAllowed (TEN-06)', () => {
  it.each(['trial', 'active', 'past_due'] as const)('%s: everyone, everywhere', (status) => {
    for (const level of ['full', 'session', 'always'] as const) {
      expect(sessionAllowed(status, 'student', level)).toBe(true);
      expect(sessionAllowed(status, 'staff', level)).toBe(true);
    }
  });

  it('suspended: students blocked; staff only for session housekeeping', () => {
    expect(sessionAllowed('suspended', 'student', 'full')).toBe(false);
    expect(sessionAllowed('suspended', 'student', 'session')).toBe(false);
    expect(sessionAllowed('suspended', 'staff', 'full')).toBe(false);
    expect(sessionAllowed('suspended', 'staff', 'session')).toBe(true);
  });

  it('cancelled: nobody, except where the route is always allowed (logout)', () => {
    expect(sessionAllowed('cancelled', 'student', 'session')).toBe(false);
    expect(sessionAllowed('cancelled', 'staff', 'session')).toBe(false);
    expect(sessionAllowed('cancelled', 'staff', 'always')).toBe(true);
    expect(sessionAllowed('cancelled', 'student', 'always')).toBe(true);
  });

  it('never lets a platform session through a tenant check', () => {
    expect(sessionAllowed('active', 'platform', 'full')).toBe(false);
  });
});
