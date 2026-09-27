import { Container, cn } from '@remix/ui';
import { getTranslations } from 'next-intl/server';
import type { GuideEntry } from '@/content/guides/guides';
import { Link } from '@/i18n/navigation';
import { cardClass, GuideMeta, guideHref, stretchedLinkClass } from './guide-card';
import { GuideVisual } from './guide-visual';

// design/claude-design/Guides.dc.html — featured card
export async function FeaturedGuide({ guide }: { guide: GuideEntry }) {
  const t = await getTranslations('guides');

  return (
    <section aria-labelledby="featured-guide-title">
      <Container className="pb-10">
        <article className={cn(cardClass, 'flex-wrap')}>
          <GuideVisual
            category={guide.category}
            tone="brand"
            size="lg"
            className="min-h-[200px] flex-[1_1_480px] p-5 sm:min-h-[320px]"
          />
          <div className="flex min-w-0 flex-[1_1_420px] flex-col justify-center gap-4 p-6 sm:p-10">
            <div className="flex flex-wrap items-center gap-2.5 text-[13px]">
              <span className="bg-accent-soft text-accent-ink rounded-xs flex h-6 items-center px-2 font-semibold">
                {t('featured')}
              </span>
              <GuideMeta guide={guide} />
            </div>
            <h2
              id="featured-guide-title"
              className="font-display m-0 text-balance text-[28px] font-bold leading-[1.1] tracking-[-0.025em] sm:text-4xl sm:leading-[1.1]"
            >
              <Link href={guideHref(guide.slug)} className={stretchedLinkClass}>
                {guide.title}
              </Link>
            </h2>
            <p className="text-ink-2 m-0">{guide.description}</p>
            <span className="text-muted text-[13px]">{t('language')}</span>
          </div>
        </article>
      </Container>
    </section>
  );
}
