import { describe, expect, it } from 'vitest';
import { code128Symbols, encodeCode128 } from './code128';

describe('STU-06 Code 128 B', () => {
  it('encodes known symbols and the weighted checksum', () => {
    expect(code128Symbols('AB')).toEqual([104, 33, 34, 102, 106]);
    expect(code128Symbols('NIL-26-0042-1')).toEqual([
      104, 46, 41, 44, 13, 18, 22, 13, 16, 16, 20, 18, 13, 17, 25, 106,
    ]);
  });
  it('preserves dash-sensitive codes and rejects unsupported characters', () => {
    expect(code128Symbols('NIL-26-0042-1')).not.toEqual(code128Symbols('NIL-26-00421'));
    for (const input of ['', '\n', '\u007f', '\u0dc3'])
      expect(() => encodeCode128(input)).toThrow(RangeError);
  });
  it('includes full stop pattern and ten-module quiet zones', () => {
    const encoded = encodeCode128('AB');
    expect(encoded.width).toBe(77);
    expect(encoded.bars[0]).toEqual({ x: 10, width: 2 });
    const last = encoded.bars.at(-1)!;
    expect(encoded.width - last.x - last.width).toBe(10);
    expect(encoded.bars.slice(-4).map((b) => b.width)).toEqual([2, 3, 1, 2]);
  });
  it('handles every printable character and long imported numbers without truncation', () => {
    const input = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
    expect(encodeCode128(input).width).toBe((input.length + 2) * 11 + 13 + 20);
  });
});
