import { describe, expect, it } from 'vitest';
import { formatLastUsed } from './device-time';

// 2026-10-15 10:00 in Colombo (UTC+05:30).
const NOW = new Date('2026-10-15T04:30:00Z');

describe('formatLastUsed', () => {
  it('shows the Colombo time for today', () => {
    expect(formatLastUsed('2026-10-15T01:42:00Z', 'en', NOW)).toBe('7:12 AM');
  });

  it('uses the Colombo calendar day, not UTC', () => {
    // 2026-10-14 19:00 UTC is already 15 Oct 00:30 in Colombo.
    expect(formatLastUsed('2026-10-14T19:00:00Z', 'en', NOW)).toBe('12:30 AM');
  });

  it('shows weekday and time within the last week, then the date', () => {
    expect(formatLastUsed('2026-10-14T16:10:00Z', 'en', NOW)).toBe('Wed 9:40 PM');
    expect(formatLastUsed('2026-09-01T04:30:00Z', 'en', NOW)).toBe('Sep 1, 2026');
  });
});
