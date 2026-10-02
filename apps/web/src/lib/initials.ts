const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function firstGrapheme(word: string): string {
  for (const { segment } of graphemes.segment(word)) return segment;
  return '';
}

/**
 * 1–2 letters for an avatar or institute tile: "Kamal Physics" → "KP", "Nimali" → "N".
 * Works per grapheme so Sinhala and Tamil letters with vowel signs stay whole.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return '';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return `${firstGrapheme(first)}${last ? firstGrapheme(last) : ''}`.toLocaleUpperCase();
}

/** First word of a display name, for greetings ("Hi Nimali"). */
export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName;
}
