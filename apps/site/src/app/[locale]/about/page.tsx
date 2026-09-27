import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AboutHero } from '@/components/about/about-hero';
import { Pilot } from '@/components/about/pilot';
import { Story } from '@/components/about/story';
import { Values } from '@/components/about/values';
import { toLocale } from '@/i18n/routing';
import { jsonLd, pageMetadata } from '@/lib/seo';
import { ROUTES, SITE } from '@/lib/site';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'about.meta' });
  return pageMetadata({
    locale,
    path: ROUTES.about,
    title: t('title'),
    description: t('description'),
  });
}

// design/claude-design/About.dc.html
export default async function AboutPage({ params }: Props) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations('about.meta');

  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'AboutPage',
        name: t('title'),
        description: t('description'),
        url: `${SITE.url}/${locale}${ROUTES.about}/`,
        inLanguage: locale,
        mainEntity: { '@id': `${SITE.url}/#org` },
      },
      {
        '@type': 'Organization',
        '@id': `${SITE.url}/#org`,
        name: SITE.company,
        url: SITE.url,
        email: SITE.email.hello,
        address: {
          '@type': 'PostalAddress',
          addressLocality: SITE.city,
          addressCountry: SITE.country,
        },
        brand: { '@type': 'Brand', name: SITE.name },
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(structuredData) }}
      />
      <AboutHero />
      <Story />
      <Values />
      <Pilot />
    </>
  );
}
