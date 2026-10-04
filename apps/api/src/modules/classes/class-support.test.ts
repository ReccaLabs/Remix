import { describe, expect, it } from 'vitest';
import { AppException } from '../../common/errors/app-exception';
import { addDays, assertSchedule, isoWeekday, mondayOf, monthOf } from './class-support';

describe('calendar helpers (Asia/Colombo dates as plain YYYY-MM-DD)', () => {
  it('isoWeekday: Monday is 1, Sunday is 7', () => {
    expect(isoWeekday('2026-10-12')).toBe(1);
    expect(isoWeekday('2026-10-15')).toBe(4);
    expect(isoWeekday('2026-10-18')).toBe(7);
  });

  it('mondayOf: the Monday of the same ISO week, also across month and year ends', () => {
    expect(mondayOf('2026-10-12')).toBe('2026-10-12');
    expect(mondayOf('2026-10-18')).toBe('2026-10-12');
    expect(mondayOf('2026-10-01')).toBe('2026-09-28');
    expect(mondayOf('2027-01-01')).toBe('2026-12-28');
  });

  it('addDays: steps over month, year and leap-day boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('monthOf: the first day of the month', () => {
    expect(monthOf('2026-10-15')).toBe('2026-10-01');
  });
});

describe('assertSchedule', () => {
  const slot = (weekday: number, startTime: string) => ({
    weekday,
    startTime,
    durationMinutes: 60,
  });

  it('accepts distinct slots, including the same time on different days', () => {
    expect(() => {
      assertSchedule([slot(1, '08:00'), slot(2, '08:00'), slot(1, '09:00')]);
    }).not.toThrow();
    expect(() => {
      assertSchedule([]);
    }).not.toThrow();
  });

  it('rejects the same weekday and start time twice, pointing at the second one', () => {
    try {
      assertSchedule([slot(1, '08:00'), slot(3, '08:00'), slot(1, '08:00')]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).errors?.[0]?.path).toBe('schedule.2.startTime');
    }
  });
});
