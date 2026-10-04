import { describe, expect, it } from 'vitest';
import { formatStudentNo, studentNumberFloor } from './counters';

describe('formatStudentNo', () => {
  it('pads to at least four digits and never truncates', () => {
    expect(formatStudentNo('BR', 1042)).toBe('BR-1042');
    expect(formatStudentNo('RS', 7)).toBe('RS-0007');
    expect(formatStudentNo('BR', 123_456)).toBe('BR-123456');
  });
});

describe('studentNumberFloor', () => {
  it('reserves the highest canonical number for this prefix only', () => {
    expect(
      studentNumberFloor('TT', ['TT-0001', 'TT-1042', 'TT-123456', 'BR-999999', 'OLD-7']),
    ).toBe(123456);
  });
  it('ignores non-canonical, malformed and unsafe suffixes', () => {
    expect(
      studentNumberFloor('TT', ['TT-7', 'TT-00007', 'TT-1e3', 'TT--1', 'TT-9007199254740993']),
    ).toBe(0);
    expect(studentNumberFloor('TT', [])).toBe(0);
  });
});
