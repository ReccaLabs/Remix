import { describe, expect, it } from 'vitest';
import type { AdminClass } from '@remix/types/api';
import {
  addDays,
  classesHref,
  classPayload,
  colomboDate,
  emptyClassValues,
  endTime,
  feeProblem,
  formatFee,
  gradesOf,
  hasClassFilters,
  mondayOf,
  parseClassesQuery,
  parseRupees,
  parseWeek,
  rupeesText,
  serverClassField,
  slotsByDate,
  teachersOf,
  validateClass,
  valuesFromClass,
  weekDates,
  type ClassFormValues,
} from './classes';

const valid = (over: Partial<ClassFormValues> = {}): ClassFormValues => ({
  ...emptyClassValues(),
  name: '2029 A/L Physics',
  grade: 'A/L 2029',
  fee: '2,500',
  ...over,
});

describe('parseRupees / rupeesText / feeProblem', () => {
  it('reads rupees with commas and cents into integer cents', () => {
    expect(parseRupees('2,500')).toBe(250_000);
    expect(parseRupees(' 1250.50 ')).toBe(125_050);
    expect(parseRupees('0')).toBe(0);
    expect(parseRupees('19.9')).toBe(1_990);
    expect(parseRupees('0.07')).toBe(7);
  });

  it('refuses anything that is not an amount', () => {
    for (const text of ['', 'abc', '-5', '1.234', '1,5,0.', '12e3', '1_000', '2500 LKR', '.5']) {
      expect(parseRupees(text), text).toBeNull();
    }
  });

  it('round-trips through the text a fee input starts with', () => {
    expect(rupeesText(250_000)).toBe('2500');
    expect(rupeesText(125_050)).toBe('1250.50');
    expect(rupeesText(0)).toBe('0');
    expect(parseRupees(rupeesText(125_005))).toBe(125_005);
  });

  it('names the problem: not an amount, or above LKR 1,000,000', () => {
    expect(feeProblem('2,500')).toBeNull();
    expect(feeProblem('1000000')).toBeNull();
    expect(feeProblem('1000000.01')).toBe('feeTooHigh');
    expect(feeProblem('nope')).toBe('feeInvalid');
  });

  it('formats a fee with cents only when there are cents', () => {
    expect(formatFee(250_000)).toBe('LKR 2,500');
    expect(formatFee(125_050)).toBe('LKR 1,250.50');
  });
});

describe('classPayload', () => {
  it('turns the form into the API body: cents, numbers, nulls', () => {
    const payload = classPayload(
      valid({
        teacherId: '0193f1c2-7b1d-7c3e-9a4f-000000000101',
        hallId: '0193f1c2-7b1d-7c3e-9a4f-0000000000a1',
        startsOn: '2026-11-01',
        schedule: [{ weekday: '6', startTime: '08:00', durationMinutes: '180' }],
      }),
    );
    expect(payload).toEqual({
      name: '2029 A/L Physics',
      grade: 'A/L 2029',
      medium: 'sinhala',
      teacherId: '0193f1c2-7b1d-7c3e-9a4f-000000000101',
      feeCents: 250_000,
      place: 'hall',
      hallId: '0193f1c2-7b1d-7c3e-9a4f-0000000000a1',
      startsOn: '2026-11-01',
      schedule: [{ weekday: 6, startTime: '08:00', durationMinutes: 180 }],
    });
  });

  it('empty choices become null, and an online class never carries a hall', () => {
    const payload = classPayload(valid({ place: 'online', hallId: 'left-over-id' }));
    expect(payload).toMatchObject({ teacherId: null, hallId: null, startsOn: null, schedule: [] });
  });
});

describe('validateClass', () => {
  it('accepts a complete class for create and edit', () => {
    expect(validateClass('create', valid())).toEqual([]);
    expect(validateClass('edit', valid())).toEqual([]);
  });

  it('reports required fields and the fee separately', () => {
    const issues = validateClass('create', valid({ name: '  ', grade: '', fee: 'abc' }));
    expect(issues).toEqual(
      expect.arrayContaining([
        { field: 'fee', message: 'feeInvalid' },
        { field: 'name', message: 'required' },
        { field: 'grade', message: 'required' },
      ]),
    );
  });

  it('a fee above the limit is its own message', () => {
    expect(validateClass('create', valid({ fee: '2000000' }))).toContainEqual({
      field: 'fee',
      message: 'feeTooHigh',
    });
  });

  it('points at the slot field that is wrong', () => {
    const issues = validateClass(
      'create',
      valid({
        schedule: [
          { weekday: '9', startTime: '08:00', durationMinutes: '60' },
          { weekday: '1', startTime: '25:00', durationMinutes: '60' },
        ],
      }),
    );
    expect(issues.map((i) => i.field)).toEqual(
      expect.arrayContaining(['schedule.0.weekday', 'schedule.1.startTime']),
    );
  });

  it('flags the second of two equal day-and-time slots', () => {
    const slot = { weekday: '3', startTime: '19:00', durationMinutes: '120' };
    expect(validateClass('create', valid({ schedule: [slot, slot] }))).toEqual([
      { field: 'schedule.1.startTime', message: 'duplicateTime' },
    ]);
  });

  it('the same time on another day is fine', () => {
    const a = { weekday: '3', startTime: '19:00', durationMinutes: '120' };
    expect(validateClass('create', valid({ schedule: [a, { ...a, weekday: '4' }] }))).toEqual([]);
  });
});

describe('valuesFromClass', () => {
  const cls: AdminClass = {
    id: '0193f1c2-7b1d-7c3e-9a4f-000000000201',
    name: 'Physics',
    grade: '2027 A/L',
    medium: 'tamil',
    teacherId: null,
    teacherName: null,
    feeCents: 125_050,
    place: 'hybrid',
    hallId: '0193f1c2-7b1d-7c3e-9a4f-0000000000a1',
    hallName: 'Hall A',
    startsOn: null,
    schedule: [{ weekday: 7, startTime: '14:00', durationMinutes: 150 }],
    studentCount: 3,
    paidPercent: null,
    archivedAt: null,
  };

  it('fills the form from a class and back to the same payload', () => {
    const values = valuesFromClass(cls);
    expect(values).toMatchObject({ fee: '1250.50', teacherId: '', startsOn: '', medium: 'tamil' });
    expect(values.schedule).toEqual([{ weekday: '7', startTime: '14:00', durationMinutes: '150' }]);
    expect(classPayload(values)).toMatchObject({
      feeCents: 125_050,
      teacherId: null,
      hallId: cls.hallId,
      schedule: [{ weekday: 7, startTime: '14:00', durationMinutes: 150 }],
    });
  });
});

describe('serverClassField', () => {
  it('maps API paths to form fields', () => {
    expect(serverClassField('feeCents')).toEqual({ field: 'fee', message: 'feeInvalid' });
    expect(serverClassField('teacherId')).toEqual({
      field: 'teacherId',
      message: 'teacherInvalid',
    });
    expect(serverClassField('hallId')).toEqual({ field: 'hallId', message: 'hallInvalid' });
    expect(serverClassField('schedule.2.startTime')).toEqual({
      field: 'schedule.2.startTime',
      message: 'duplicateTime',
    });
    expect(serverClassField('name')).toEqual({ field: 'name', message: 'invalid' });
  });
});

describe('list query', () => {
  it('reads filters from the URL and drops what is invalid', () => {
    expect(parseClassesQuery({ q: 'phy', place: 'online', archived: 'true' })).toEqual({
      q: 'phy',
      place: 'online',
      archived: 'true',
    });
    expect(parseClassesQuery({ place: 'moon', teacherId: 'nope', q: 'ok' })).toEqual({
      q: 'ok',
      archived: 'false',
    });
    expect(parseClassesQuery({ q: ['a', 'b'], unknown: 'x' })).toEqual({
      q: 'a',
      archived: 'false',
    });
  });

  it('builds short URLs: defaults are left out', () => {
    expect(classesHref('/admin/classes', { archived: 'false' })).toBe('/admin/classes');
    expect(classesHref('/admin/classes', { q: 'a b', archived: 'true', place: 'hall' })).toBe(
      '/admin/classes?q=a+b&place=hall&archived=true',
    );
  });

  it('knows when a filter narrows the list', () => {
    expect(hasClassFilters({ archived: 'false' })).toBe(false);
    expect(hasClassFilters({ archived: 'true' })).toBe(true);
    expect(hasClassFilters({ grade: '2027 A/L', archived: 'false' })).toBe(true);
  });

  it('lists distinct grades and teachers for the filter choices', () => {
    expect(gradesOf([{ grade: 'B' }, { grade: 'A' }, { grade: 'B' }])).toEqual(['B', 'A']);
    expect(
      teachersOf([
        { teacherId: 't2', teacherName: 'Zed' },
        { teacherId: null, teacherName: null },
        { teacherId: 't1', teacherName: 'Amal' },
        { teacherId: 't2', teacherName: 'Zed' },
      ]),
    ).toEqual([
      { id: 't1', name: 'Amal' },
      { id: 't2', name: 'Zed' },
    ]);
  });
});

describe('endTime', () => {
  it('adds minutes to a start time', () => {
    expect(endTime('08:00', 180)).toBe('11:00');
    expect(endTime('19:30', 45)).toBe('20:15');
  });
  it('wraps past midnight instead of printing 25:00', () => {
    expect(endTime('23:30', 60)).toBe('00:30');
  });
});

describe('timetable dates (Asia/Colombo, plain YYYY-MM-DD)', () => {
  it('finds the Monday of any date, across month and year ends', () => {
    expect(mondayOf('2026-10-15')).toBe('2026-10-12');
    expect(mondayOf('2026-10-18')).toBe('2026-10-12');
    expect(mondayOf('2026-10-12')).toBe('2026-10-12');
    expect(mondayOf('2027-01-01')).toBe('2026-12-28');
  });

  it('lists the seven days of a week, Monday first', () => {
    expect(weekDates('2026-10-12')).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
  });

  it('steps weeks forward and back', () => {
    expect(addDays('2026-10-12', 7)).toBe('2026-10-19');
    expect(addDays('2026-10-12', -7)).toBe('2026-10-05');
  });

  it('uses the date in Colombo, not UTC: 20:00 UTC is already tomorrow there', () => {
    expect(colomboDate(new Date('2026-10-15T20:00:00Z'))).toBe('2026-10-16');
    expect(colomboDate(new Date('2026-10-15T04:30:00Z'))).toBe('2026-10-15');
  });

  it('?week= accepts any date of the week, and falls back to this week for junk', () => {
    const today = '2026-10-15';
    expect(parseWeek('2026-10-21', today)).toBe('2026-10-19');
    expect(parseWeek('2026-10-19', today)).toBe('2026-10-19');
    expect(parseWeek(undefined, today)).toBe('2026-10-12');
    expect(parseWeek('nope', today)).toBe('2026-10-12');
    expect(parseWeek('2026-02-31', today)).toBe('2026-10-12');
    expect(parseWeek(['2026-10-26', 'x'], today)).toBe('2026-10-26');
  });

  it('groups slots by date', () => {
    const slot = (date: string, className: string) =>
      ({ date, className }) as unknown as Parameters<typeof slotsByDate>[0][number];
    const grouped = slotsByDate([
      slot('2026-10-12', 'a'),
      slot('2026-10-13', 'b'),
      slot('2026-10-12', 'c'),
    ]);
    expect([...grouped.keys()]).toEqual(['2026-10-12', '2026-10-13']);
    expect(grouped.get('2026-10-12')).toHaveLength(2);
  });
});
