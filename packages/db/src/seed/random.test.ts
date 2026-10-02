import { describe, expect, it } from 'vitest';
import { createRng } from './random';

describe('createRng', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const seqA = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(seqA);
  });

  it('keeps int() within bounds and pick() within the list', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1_000; i++) {
      const n = rng.int(3, 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
      expect(['x', 'y']).toContain(rng.pick(['x', 'y']));
    }
    expect(() => rng.pick([])).toThrow(RangeError);
  });
});
