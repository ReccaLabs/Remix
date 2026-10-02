import { describe, expect, it } from 'vitest';
import { brandCssVars, brandStyle } from './brand';

describe('brandCssVars', () => {
  it('derives brand, hover and soft variables from a valid colour', () => {
    const vars = brandCssVars('#2B4BF2');
    expect(vars).toEqual({
      '--color-brand': '#2b4bf2',
      '--color-brand-hover': expect.stringMatching(/^#[0-9a-f]{6}$/),
      '--color-brand-soft': expect.stringMatching(/^#[0-9a-f]{6}$/),
    });
  });

  it('makes hover darker and soft lighter', () => {
    expect(brandCssVars('#808080')).toEqual({
      '--color-brand': '#808080',
      '--color-brand-hover': '#747474',
      '--color-brand-soft': '#f6f6f6',
    });
  });

  it.each([
    null,
    undefined,
    '',
    'red',
    '#fff',
    '#12345',
    '#1234567',
    '#gggggg',
    '2b4bf2',
    ' #2b4bf2',
    '#2b4bf2;',
    '#2b4bf2; background: url(https://evil.example/x)',
    'red;}body{display:none',
    'var(--x)',
    'url(javascript:alert(1))',
    'expression(alert(1))',
    123456,
    {},
  ])('rejects %j (keeps the ReMix theme)', (value) => {
    expect(brandCssVars(value)).toBeUndefined();
    expect(brandStyle(value)).toBeUndefined();
  });
});
