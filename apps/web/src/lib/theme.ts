import { brandColorSchema, contrastRatio, hasReadableContrast } from '@remix/types/api';

/**
 * Live feedback for the brand colour field (TEN-03). The same rule as the API's schema: white
 * text on the colour must reach a contrast of 4.5 to 1, so what the form accepts the API accepts.
 */

export type ColorState =
  { state: 'none' } | { state: 'invalid' } | { state: 'low' | 'ok'; color: string; ratio: string };

// White is the colour of the text on a brand-coloured button (the WCAG rule), not a UI colour.
// eslint-disable-next-line no-restricted-syntax
const WHITE = '#ffffff';

// The colour input needs some valid value when the field is empty or not a colour yet: the
// default --color-brand (packages/ui/src/theme.css).
// eslint-disable-next-line no-restricted-syntax
const DEFAULT_PICKER = '#2b4bf2';

/** One decimal, rounded down, so "4.5" is never shown for a colour that scores 4.46. */
const showRatio = (ratio: number): string => (Math.floor(ratio * 10) / 10).toFixed(1);

export function colorState(input: string): ColorState {
  const text = input.trim();
  if (text === '') return { state: 'none' };
  if (!brandColorSchema.safeParse(text).success) return { state: 'invalid' };
  const color = text.toLowerCase();
  return {
    state: hasReadableContrast(color) ? 'ok' : 'low',
    color,
    ratio: showRatio(contrastRatio(color, WHITE)),
  };
}

/** The value to send: a lower-case `#rrggbb`, or `null` for "use the ReMix blue". */
export function colorToSave(input: string): string | null {
  const state = colorState(input);
  return state.state === 'ok' ? state.color : null;
}

/** `#rrggbb` for the colour picker (which cannot hold an empty or invalid value). */
export function pickerValue(input: string, fallback = DEFAULT_PICKER): string {
  const state = colorState(input);
  return state.state === 'ok' || state.state === 'low' ? state.color : fallback;
}

/** An https URL the API will accept, or `null` for empty. `undefined` when it is invalid. */
export function urlToSave(input: string): string | null | undefined {
  const text = input.trim();
  if (text === '') return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && text.length <= 2048 ? text : undefined;
  } catch {
    return undefined;
  }
}
