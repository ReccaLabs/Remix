import { describe, expect, it } from 'vitest';
import { calendarDate, monthStart } from './business-date';

describe('calendarDate / monthStart (Asia/Colombo, UTC+05:30, no DST)', () => {
  it('uses the Colombo date, not the UTC date, around midnight', () => {
    // 18:29:59Z = 23:59:59 Colombo on the same day; 18:30Z = 00:00 the next day.
    expect(calendarDate(new Date('2026-10-14T18:29:59Z'))).toBe('2026-10-14');
    expect(calendarDate(new Date('2026-10-14T18:30:00Z'))).toBe('2026-10-15');
  });

  it('rolls to the next month at Colombo midnight while UTC is still in the old month', () => {
    const lastSecond = new Date('2026-09-30T18:29:59Z');
    const firstInstant = new Date('2026-09-30T18:30:00Z');
    expect(lastSecond.getUTCMonth()).toBe(8); // September in UTC
    expect(firstInstant.getUTCMonth()).toBe(8); // still September in UTC…
    expect(monthStart(lastSecond)).toBe('2026-09-01');
    expect(monthStart(firstInstant)).toBe('2026-10-01'); // …but October in Colombo
  });

  it('rolls over the year at Colombo midnight on 1 January', () => {
    expect(monthStart(new Date('2026-12-31T18:29:59Z'))).toBe('2026-12-01');
    expect(monthStart(new Date('2026-12-31T18:30:00Z'))).toBe('2027-01-01');
  });

  it('is the same month for UTC midnight on the 1st (05:30 in Colombo)', () => {
    expect(monthStart(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11-01');
  });

  it('handles a leap day', () => {
    expect(calendarDate(new Date('2028-02-28T18:30:00Z'))).toBe('2028-02-29');
    expect(monthStart(new Date('2028-02-29T18:30:00Z'))).toBe('2028-03-01');
  });

  it('accepts another IANA zone', () => {
    expect(calendarDate(new Date('2026-10-14T18:30:00Z'), 'UTC')).toBe('2026-10-14');
  });
});
