import { defineRouting } from 'next-intl/routing';

/**
 * Live locales. Sinhala and Tamil are added here only after native speakers have reviewed
 * the copy (DEVELOPMENT.md §3.10) — until then they appear as "coming soon" in the switcher.
 */
export const routing = defineRouting({
  locales: ['en'],
  defaultLocale: 'en',
  localePrefix: 'always',
});

export type Locale = (typeof routing.locales)[number];

/** Shown in the language switcher; disabled until moved into `routing.locales`. */
export const LANGUAGES = [
  { code: 'en', short: 'EN', label: 'English', font: '' },
  { code: 'si', short: 'සිං', label: 'සිංහල', font: 'font-sinhala' },
  { code: 'ta', short: 'த', label: 'தமிழ்', font: 'font-tamil' },
] as const;

export function isLiveLocale(code: string): code is Locale {
  return (routing.locales as readonly string[]).includes(code);
}

/** Narrow a `[locale]` route param. Pages call this first: `const locale = toLocale((await params).locale)`. */
export function toLocale(value: string): Locale {
  return isLiveLocale(value) ? value : routing.defaultLocale;
}
