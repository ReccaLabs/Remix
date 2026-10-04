import { describe, expect, it } from 'vitest';
import { updateThemeSchema } from '@remix/types/api';
import { colorState, colorToSave, pickerValue, urlToSave } from './theme';

describe('colorState', () => {
  it('empty means the ReMix blue', () => {
    expect(colorState('')).toEqual({ state: 'none' });
    expect(colorState('   ')).toEqual({ state: 'none' });
  });

  it('only #rrggbb is a colour; CSS injection attempts are invalid', () => {
    for (const text of [
      'red',
      '#12345',
      '#1234567',
      '#gggggg',
      '0f766e',
      'red;}body{',
      '#000;--x:',
    ]) {
      expect(colorState(text), text).toEqual({ state: 'invalid' });
    }
  });

  it('white text on a dark colour is readable, with the ratio rounded down', () => {
    const state = colorState('#0F766E');
    expect(state).toMatchObject({ state: 'ok', color: '#0f766e' });
    expect(Number((state as { ratio: string }).ratio)).toBeGreaterThanOrEqual(4.5);
  });

  it('a light colour is too low', () => {
    expect(colorState('#ffcc00')).toMatchObject({ state: 'low' });
    expect(colorState('#ffffff')).toMatchObject({ state: 'low', ratio: '1.0' });
  });

  it('never rounds a failing ratio up to 4.5', () => {
    // #777777 scores 4.48 on white: it must read "4.4" and fail.
    expect(colorState('#777777')).toMatchObject({ state: 'low', ratio: '4.4' });
    expect(colorState('#767676')).toMatchObject({ state: 'ok' });
  });

  it('agrees with the API schema about what may be saved', () => {
    for (const color of [
      '#0f766e',
      '#ffcc00',
      '#777777',
      '#767676',
      '#2b4bf2',
      '#ffffff',
      '#000000',
    ]) {
      const web = colorState(color).state === 'ok';
      const api = updateThemeSchema.safeParse({ brandColor: color }).success;
      expect(web, color).toBe(api);
    }
  });
});

describe('colorToSave / pickerValue', () => {
  it('saves a lower-case colour, or null for default / blocked input', () => {
    expect(colorToSave('#0F766E')).toBe('#0f766e');
    expect(colorToSave('')).toBeNull();
    expect(colorToSave('#ffcc00')).toBeNull();
  });

  it('the colour picker always gets a valid #rrggbb', () => {
    expect(pickerValue('#0F766E')).toBe('#0f766e');
    expect(pickerValue('')).toBe('#2b4bf2');
    expect(pickerValue('nonsense')).toBe('#2b4bf2');
    expect(pickerValue('#ffcc00')).toBe('#ffcc00');
  });
});

describe('urlToSave', () => {
  it('empty is null, https is kept, everything else is invalid (undefined)', () => {
    expect(urlToSave('')).toBeNull();
    expect(urlToSave(' https://cdn.example.test/logo.png ')).toBe(
      'https://cdn.example.test/logo.png',
    );
    expect(urlToSave('http://cdn.example.test/logo.png')).toBeUndefined();
    expect(urlToSave('javascript:alert(1)')).toBeUndefined();
    expect(urlToSave('data:image/png;base64,AAAA')).toBeUndefined();
    expect(urlToSave('//cdn.example.test/logo.png')).toBeUndefined();
    expect(urlToSave('not a url')).toBeUndefined();
    expect(urlToSave(`https://x.test/${'a'.repeat(2100)}`)).toBeUndefined();
  });
});
