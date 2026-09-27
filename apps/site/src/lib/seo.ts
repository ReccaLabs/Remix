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

/** Serialise JSON-LD safely (prevents `</script>` breaking out of the tag). */
export function jsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
