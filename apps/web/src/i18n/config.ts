/**
 * Live locales. URLs carry no locale segment: the locale will come from the signed-in user
 * (`tenant_users.locale`) or the institute's default. Sinhala and Tamil are added here only
 * after native review (DEVELOPMENT.md §3.10) — never machine-translated.
 */
export const LOCALES = ['en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const TIME_ZONE = 'Asia/Colombo';
