import { describe, expect, it } from 'vitest';
import { createWedgeDetector } from './card-wedge';

describe('STU-06 wedge bursts', () => {
  it('accepts a fast code or UID only when Enter ends the burst', () => {
    for (const value of ['NIL-26-0042-1', '04A21B9C']) {
      const detect = createWedgeDetector();
      [...value].forEach((key, n) => expect(detect(key, n * 10)).toBeNull());
      expect(detect('Enter', value.length * 10)).toBe(value);
      expect(detect('Enter', value.length * 10 + 1)).toBeNull();
    }
  });
  it('rejects slow typing, pauses at 50ms, short inputs and control keys', () => {
    const detect = createWedgeDetector();
    for (const [key, time] of [
      ['A', 0],
      ['B', 50],
      ['C', 100],
      ['Enter', 150],
    ] as const)
      expect(detect(key, time)).toBeNull();
    detect('A', 200);
    detect('B', 210);
    expect(detect('Enter', 220)).toBeNull();
    detect('A', 300);
    detect('B', 310);
    detect('Escape', 320);
    expect(detect('Enter', 330)).toBeNull();
  });
});
