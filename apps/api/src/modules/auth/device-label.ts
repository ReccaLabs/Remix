/**
 * Human label for a device from its User-Agent, e.g. "Chrome on Android" (AUTH-03/04 device
 * list). Deliberately coarse: it helps a student recognise a device, it is not a fingerprint and
 * never used for a security decision. Order matters — many browsers include "Chrome"/"Safari".
 */
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bUCBrowser\//, 'UC Browser'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bAndroid\b/, 'Android'],
  [/\biPad\b/, 'iPad'],
  [/\b(?:iPhone|iPod)\b/, 'iPhone'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'Mac'],
  [/\bLinux\b/, 'Linux'],
];

export const UNKNOWN_DEVICE = 'Unknown device';
/** `devices.user_agent` is capped at 512 characters by a check constraint. */
export const MAX_USER_AGENT_LENGTH = 512;
const MAX_LABEL_LENGTH = 120;

export function deviceLabel(userAgent: string | undefined): string {
  if (!userAgent) return UNKNOWN_DEVICE;
  const ua = userAgent.slice(0, MAX_USER_AGENT_LENGTH);
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1];
  const label =
    browser && system
      ? `${browser} on ${system}`
      : (browser ?? (system ? `${system} device` : UNKNOWN_DEVICE));
  return label.slice(0, MAX_LABEL_LENGTH);
}

/** The User-Agent as stored: trimmed, control characters removed, capped, or null. */
export function storedUserAgent(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const cleaned = userAgent.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned ? cleaned.slice(0, MAX_USER_AGENT_LENGTH) : null;
}
