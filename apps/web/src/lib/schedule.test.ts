import { formatLKR } from '@remix/types';
import type { ClassSummary } from '@remix/types/api';
import { describe, expect, it } from 'vitest';
import {
  colomboClock,
  formatSlot,
  greetingPeriod,
  slotInstant,
  slotsToday,
  sortedSchedule,
} from './schedule';

const cls = (id: string, schedule: ClassSummary['schedule']): ClassSummary => ({
  id: `0193f1c2-7b1d-7c3e-9a4f-00000000000${id}`,
  name: `Class ${id}`,
  grade: '2027 A/L',
  medium: 'sinhala',
  teacherName: null,
  feeCents: 250_000,
  place: 'hall',
  schedule,
});

describe('formatSlot', () => {
  it('names ISO weekdays Monday (1) to Sunday (7)', () => {
    const names = [1, 2, 3, 4, 5, 6, 7].map(
      (weekday) => formatSlot({ weekday, startTime: '08:00' }, 'en').weekday,
    );
    expect(names).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('shows the Colombo wall-clock time, not the server or device zone', () => {
    expect(formatSlot({ weekday: 6, startTime: '08:00' }, 'en')).toEqual({
      weekday: 'Sat',
      time: '8:00 AM',
    });
    expect(formatSlot({ weekday: 6, startTime: '19:30' }, 'en').time).toBe('7:30 PM');
  });

  it('keeps the weekday right for slots that are the previous day in UTC', () => {
    // 01:00 Monday in Colombo is 19:30 Sunday UTC.
    expect(slotInstant({ weekday: 1, startTime: '01:00' }).toISOString()).toBe(
      '2023-12-31T19:30:00.000Z',
    );
    expect(formatSlot({ weekday: 1, startTime: '01:00' }, 'en')).toEqual({
      weekday: 'Mon',
      time: '1:00 AM',
    });
    expect(formatSlot({ weekday: 7, startTime: '23:59' }, 'en')).toEqual({
      weekday: 'Sun',
      time: '11:59 PM',
    });
  });
});

describe('colomboClock and greetingPeriod', () => {
  it('reads weekday and hour in Asia/Colombo', () => {
    // Fri 2 Oct 2026 20:00 UTC = Sat 3 Oct 01:30 in Colombo.
    expect(colomboClock(new Date('2026-10-02T20:00:00Z'))).toEqual({
      weekday: 6,
      hour: 1,
      minute: 30,
    });
    // Sat 3 Oct 2026 18:29 UTC = Sat 23:59 → Sunday is 7, not 0.
    expect(colomboClock(new Date('2026-10-03T18:31:00Z')).weekday).toBe(7);
  });

  it('greets by Colombo time of day', () => {
    expect(greetingPeriod(new Date('2026-10-02T02:30:00Z'))).toBe('morning'); // 08:00
    expect(greetingPeriod(new Date('2026-10-02T06:30:00Z'))).toBe('afternoon'); // 12:00
    expect(greetingPeriod(new Date('2026-10-02T11:30:00Z'))).toBe('evening'); // 17:00
    expect(greetingPeriod(new Date('2026-10-02T18:00:00Z'))).toBe('evening'); // 23:30
    expect(greetingPeriod(new Date('2026-10-01T20:00:00Z'))).toBe('morning'); // 01:30 next day
  });
});

describe('slotsToday', () => {
  it("lists today's Colombo slots across classes, earliest first", () => {
    const classes = [
      cls('1', [
        { weekday: 6, startTime: '19:00', durationMinutes: 120 },
        { weekday: 3, startTime: '16:00', durationMinutes: 90 },
      ]),
      cls('2', [{ weekday: 6, startTime: '08:00', durationMinutes: 120 }]),
    ];
    // Sat 3 Oct 2026 06:00 in Colombo.
    const today = slotsToday(classes, new Date('2026-10-03T00:30:00Z'));
    expect(today.map((s) => [s.className, s.slot.startTime])).toEqual([
      ['Class 2', '08:00'],
      ['Class 1', '19:00'],
    ]);
    expect(slotsToday(classes, new Date('2026-10-04T00:30:00Z'))).toEqual([]);
  });
});

describe('sortedSchedule', () => {
  it('orders by ISO weekday then time without mutating the input', () => {
    const schedule = [
      { weekday: 7, startTime: '09:00', durationMinutes: 60 },
      { weekday: 1, startTime: '18:00', durationMinutes: 60 },
      { weekday: 1, startTime: '07:00', durationMinutes: 60 },
    ];
    expect(sortedSchedule(schedule).map((s) => `${s.weekday} ${s.startTime}`)).toEqual([
      '1 07:00',
      '1 18:00',
      '7 09:00',
    ]);
    expect(schedule[0]?.weekday).toBe(7);
  });
});

describe('fee formatting', () => {
  it('shows the exact rupee amount from cents', () => {
    expect(formatLKR(250_000, { exact: true })).toBe('LKR 2,500.00');
    expect(formatLKR(125_050, { exact: true })).toBe('LKR 1,250.50');
    expect(formatLKR(0, { exact: true })).toBe('LKR 0.00');
  });
});
