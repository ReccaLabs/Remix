import { describe, expect, it } from 'vitest';
import { normalizeCardInput } from '@remix/types/api';
import { normalizeStudentNo } from './student-numbers';

describe('student number identity', () => {
  it('uses exactly the card contract normal form and preserves dashes', () => {
    for (const input of [' nil - 26-0042 ', '\tnil-26-0042\r\n', 'Old\u00a0Number', 'සිසු']) {
      expect(normalizeStudentNo(input)).toBe(normalizeCardInput(input));
    }
    expect(normalizeStudentNo('nil -26-0042-1')).toBe('NIL-26-0042-1');
    expect(normalizeStudentNo('NIL-26-0042-1')).not.toBe(normalizeStudentNo('NIL-26-00421'));
  });
});
