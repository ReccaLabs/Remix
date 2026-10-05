import { describe, expect, it } from 'vitest';
import { formatStudentNo, studentJoiningYear, studentNumberFloor } from './counters';

describe('formatStudentNo', () => {
  it('pads to at least four digits and never truncates', () => {
    expect(formatStudentNo('BR', 2026, 1042)).toBe('BR-26-1042');
    expect(formatStudentNo('RS', 2027, 7)).toBe('RS-27-0007');
    expect(formatStudentNo('BR', 2026, 10_000)).toBe('BR-26-10000');
    expect(formatStudentNo('BR', 2026, 123_456)).toBe('BR-26-123456');
  });
  it('rolls over at Colombo midnight', () => {
    expect(studentJoiningYear(new Date('2026-12-31T18:29:59.999Z'))).toBe(2026);
    expect(studentJoiningYear(new Date('2026-12-31T18:30:00.000Z'))).toBe(2027);
  });
});

describe('studentNumberFloor', () => {
  it('reserves the highest canonical number for this prefix only', () => {
    expect(
      studentNumberFloor('TT', 2026, [
        'TT-26-0001',
        'TT-26-1042',
        'TT-26-123456',
        'TT-27-999999',
        'BR-26-999999',
        'TT-123456',
      ]),
    ).toBe(123456);
  });
  it('ignores non-canonical, malformed and unsafe suffixes', () => {
    expect(
      studentNumberFloor('TT', 2026, [
        'TT-26-7',
        'TT-26-00007',
        'TT-26-0000',
        'TT-26-1e3',
        'TT-26--1',
        'TT-26-9007199254740993',
      ]),
    ).toBe(0);
    expect(studentNumberFloor('TT', 2026, [])).toBe(0);
  });
});
