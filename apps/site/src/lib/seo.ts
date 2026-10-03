import type { Metadata } from 'next';
import { routing } from '@/i18n/routing';
import { SITE } from './site';

/**
 * Per-page metadata with canonical + hreflang alternates.
 * `path` is locale-less, e.g. '/pricing'. Use from each page's generateMetadata().
 */
export function pageMetadata({
  locale,
  path,
  title,
  description,
}: {
  locale: string;
  path: string;
  title: string;
  description: string;
}): Metadata {
  const clean = path === '/' ? '/' : `${path.replace(/\/$/, '')}/`;
  const url = (l: string) => `/${l}${clean}`;

  return {
    title,
    description,
    alternates: {
      canonical: url(locale),
      languages: {
        ...Object.fromEntries(routing.locales.map((l) => [l, url(l)])),
        'x-default': url(routing.defaultLocale),
      },
    },
    openGraph: {
      type: 'website',
      siteName: SITE.name,
      title,
      description,
      url: url(locale),
      locale: locale === 'en' ? 'en_LK' : locale === 'si' ? 'si_LK' : 'ta_LK',
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

/**
 * Serialise JSON-LD for an inline <script>. Escapes `<` (so `</script>` can't close the tag), `>`
 * and `&` (no HTML-comment or entity tricks) and U+2028/U+2029 (line separators some parsers treat
 * as newlines). The result is still valid JSON with the same meaning.
 */
export function jsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
