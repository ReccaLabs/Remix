import { Container, DisplayHeading, Eyebrow } from '@remix/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FeaturedGuide } from '@/components/guides/featured-guide';
import { guideHref } from '@/components/guides/guide-card';
import { GuideList } from '@/components/guides/guide-list';
import { GuidesCta } from '@/components/guides/guides-cta';
import { GUIDES } from '@/content/guides/guides';
import { toLocale } from '@/i18n/routing';
import { jsonLd, pageMetadata } from '@/lib/seo';
import { ROUTES, SITE } from '@/lib/site';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'guides.meta' });
  return pageMetadata({
    locale,
    path: ROUTES.guides,
    title: t('title'),
    description: t('description'),
  });
}

// design/claude-design/Guides.dc.html
export default async function GuidesPage({ params }: Props) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations('guides');

  const featured = GUIDES.find((g) => g.featured);
  const rest = GUIDES.filter((g) => g !== featured);

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: t('meta.title'),
    description: t('meta.description'),
    url: `${SITE.url}/${locale}${ROUTES.guides}/`,
    inLanguage: locale,
    publisher: { '@id': `${SITE.url}/#org` },
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: GUIDES.map((g, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE.url}/${locale}${guideHref(g.slug)}/`,
        name: g.title,
      })),
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(structuredData) }}
      />
      <section aria-labelledby="guides-title">
        <Container className="flex flex-col gap-5 pb-10 pt-12 sm:pt-[72px]">
          <Eyebrow>{t('hero.eyebrow')}</Eyebrow>
          <DisplayHeading as="h1" id="guides-title" size="xl" className="max-w-[820px]">
            {t('hero.title')}
          </DisplayHeading>
          <p className="text-ink-2 m-0 max-w-[600px] text-pretty text-lg leading-7">
            {t('hero.intro')}
          </p>
        </Container>
      </section>
      {featured && <FeaturedGuide guide={featured} />}
      <GuideList guides={rest} />
      <GuidesCta />
    </>
  );
}
