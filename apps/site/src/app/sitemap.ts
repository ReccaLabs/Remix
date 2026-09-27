import type { MetadataRoute } from 'next';
import { GUIDES } from '@/content/guides/guides';
import { routing } from '@/i18n/routing';
import { ROUTES, SITE } from '@/lib/site';

export const dynamic = 'force-static';

// Public, indexable pages. Add new top-level pages here.
const PAGES = [
  ROUTES.home,
  ROUTES.pricing,
  ROUTES.institutes,
  ROUTES.teachers,
  ROUTES.guides,
  ROUTES.about,
  ROUTES.demo,
  ROUTES.findClass,
  ROUTES.privacy,
  ROUTES.terms,
  ROUTES.dataProtection,
];

export default function sitemap(): MetadataRoute.Sitemap {
  const url = (locale: string, path: string) =>
    `${SITE.url}/${locale}${path === '/' ? '/' : `${path}/`}`;
  const entry = (path: string, lastModified?: string): MetadataRoute.Sitemap[number] => ({
    url: url(routing.defaultLocale, path),
    ...(lastModified ? { lastModified } : {}),
    changeFrequency: path === ROUTES.home ? 'weekly' : 'monthly',
    priority: path === ROUTES.home ? 1 : 0.7,
    alternates: {
      languages: Object.fromEntries(routing.locales.map((l) => [l, url(l, path)])),
    },
  });

  return [
    ...PAGES.map((path) => entry(path)),
    ...GUIDES.map((g) => entry(`${ROUTES.guides}/${g.slug}`, g.updated ?? g.published)),
  ];
}
