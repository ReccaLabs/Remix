# 0002 — i18n: next-intl, per-namespace message files, locales go live only after native review

- **Status:** Accepted · 2026-09-25

## Context

The site and product must work in English, Sinhala and Tamil. Brand rules say Sinhala/Tamil copy is written or reviewed by native speakers, never machine-translated. Several people (and agents) edit copy at once.

## Decision

- **next-intl** with a `[locale]` segment and `localePrefix: 'always'` (`/en/…`, `/si/…`, `/ta/…`), statically generated.
- Messages split into **one JSON file per namespace** (`messages/<locale>/<namespace>.json`), merged at request time in `src/i18n/request.ts`. Key types are derived from the English files, so a missing or misspelt key fails `tsc`.
- `routing.locales` lists only **live** locales. Sinhala and Tamil show as "coming soon" in the switcher until their files are complete and reviewed; enabling one is a one-line change plus the message files.
- Script fonts (Noto Sans Sinhala/Tamil) are self-hosted via `next/font` with `preload: false` until those locales are live.

## Consequences

- No half-translated pages in production, and no wrong `lang` attributes.
- Adding a locale requires every namespace file to exist for it.
- Long-form guide articles are MDX per locale, not message JSON.
