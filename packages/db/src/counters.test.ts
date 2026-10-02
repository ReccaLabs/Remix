import { describe, expect, it } from 'vitest';
import { formatStudentNo } from './counters';

describe('formatStudentNo', () => {
  it('pads to at least four digits and never truncates', () => {
    expect(formatStudentNo('BR', 1042)).toBe('BR-1042');
    expect(formatStudentNo('RS', 7)).toBe('RS-0007');
    expect(formatStudentNo('BR', 123_456)).toBe('BR-123456');
  });
});
