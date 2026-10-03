import { Container } from '@remix/ui';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { GuideCard, GuideMeta, guideHref } from '@/components/guides/guide-card';
import { GuidesCta } from '@/components/guides/guides-cta';
import { JsonLd } from '@/components/seo/json-ld';
import { loadGuideBody } from '@/content/guides/content';
import { getGuide, GUIDES } from '@/content/guides/guides';
import { Link } from '@/i18n/navigation';
import { toLocale } from '@/i18n/routing';
import { pageMetadata } from '@/lib/seo';
import { ROUTES, SITE } from '@/lib/site';

type Props = { params: Promise<{ locale: string; slug: string }> };

// Static export: every guide is pre-rendered; unknown slugs 404. The locale comes from the parent layout.
export const dynamicParams = false;

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const guide = getGuide(slug);
  if (!guide) return {};

  const base = pageMetadata({
    locale,
    path: guideHref(slug),
    title: guide.title,
    description: guide.description,
  });
  return {
    ...base,
    openGraph: {
      ...base.openGraph,
      type: 'article',
      publishedTime: guide.published,
      modifiedTime: guide.updated ?? guide.published,
      authors: [SITE.company],
    },
  };
}

/** Guide dates are calendar days in Asia/Colombo. */
const colomboDate = (iso: string) => new Date(`${iso}T00:00:00+05:30`);

export default async function GuidePage({ params }: Props) {
  const { locale: raw, slug } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);

  const guide = getGuide(slug);
  if (!guide) notFound();

  const t = await getTranslations('guides');
  const format = await getFormatter();
  const Body = await loadGuideBody(guide.slug);

  const url = `${SITE.url}/${locale}${guideHref(guide.slug)}/`;
  const more = GUIDES.filter((g) => g.slug !== guide.slug).slice(0, 3);
  const publishedLabel = format.dateTime(colomboDate(guide.published), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: guide.title,
        description: guide.description,
        datePublished: guide.published,
        dateModified: guide.updated ?? guide.published,
        inLanguage: 'en',
        timeRequired: `PT${guide.readingMinutes}M`,
        articleSection: t(`categories.${guide.category}`),
        mainEntityOfPage: url,
        url,
        author: {
          '@type': 'Organization',
          '@id': `${SITE.url}/#org`,
          name: SITE.company,
          url: SITE.url,
        },
        publisher: {
          '@type': 'Organization',
          '@id': `${SITE.url}/#org`,
          name: SITE.company,
          url: SITE.url,
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: t('article.home'),
            item: `${SITE.url}/${locale}/`,
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: t('article.guides'),
            item: `${SITE.url}/${locale}${ROUTES.guides}/`,
          },
          { '@type': 'ListItem', position: 3, name: guide.title, item: url },
        ],
      },
    ],
  };

  const crumbLink = 'text-muted hover:text-ink';

  return (
    <>
      <JsonLd data={structuredData} />
      <article aria-labelledby="guide-title">
        <Container className="pt-8 sm:pt-12">
          <nav aria-label={t('article.breadcrumbLabel')}>
            <ol className="text-muted m-0 flex list-none flex-wrap items-center gap-1.5 p-0 text-sm">
              <li>
                <Link href={ROUTES.home} className={crumbLink}>
                  {t('article.home')}
                </Link>
              </li>
              <li aria-hidden>
                <ChevronRight size={14} />
              </li>
              <li>
                <Link href={ROUTES.guides} className={crumbLink}>
                  {t('article.guides')}
                </Link>
              </li>
              <li aria-hidden>
                <ChevronRight size={14} />
              </li>
              <li aria-current="page" className="text-ink max-w-full truncate sm:max-w-[48ch]">
                {guide.title}
              </li>
            </ol>
          </nav>

          <header className="flex max-w-[860px] flex-col gap-5 pb-10 pt-8 sm:pb-12 sm:pt-12">
            <GuideMeta guide={guide} className="text-sm" />
            <h1
              id="guide-title"
              className="font-display m-0 text-balance text-[36px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[48px] lg:text-[56px]"
            >
              {guide.title}
            </h1>
            <p className="text-ink-2 m-0 max-w-[640px] text-pretty text-lg leading-7">
              {guide.description}
            </p>
            <p className="text-muted m-0 text-sm">
              {t.rich('article.published', {
                date: publishedLabel,
                time: (chunks) => <time dateTime={guide.published}>{chunks}</time>,
              })}
            </p>
          </header>

          <div className="border-line-warm border-t pb-12 pt-10 sm:pt-12">
            <div className="max-w-[68ch] text-[17px] leading-7 sm:text-lg sm:leading-[30px] [&>:first-child]:mt-0">
              <Body />
            </div>
            <Link
              href={ROUTES.guides}
              className="text-brand mt-12 inline-flex min-h-11 items-center gap-2 font-semibold"
            >
              <ArrowLeft size={16} aria-hidden />
              {t('article.back')}
            </Link>
          </div>
        </Container>
      </article>

      {more.length > 0 && (
        <section aria-labelledby="more-guides-title">
          <Container className="flex flex-col gap-6 pb-16 sm:pb-24">
            <h2
              id="more-guides-title"
              className="font-display m-0 text-[28px] font-bold leading-[1.1] tracking-[-0.025em] sm:text-4xl sm:leading-[1.1]"
            >
              {t('article.more')}
            </h2>
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-4 p-0">
              {more.map((g) => (
                <li key={g.slug}>
                  <GuideCard guide={g} />
                </li>
              ))}
            </ul>
          </Container>
        </section>
      )}

      <GuidesCta secondary="demo" />
    </>
  );
}
