import { cn } from '@remix/ui';
import { getTranslations } from 'next-intl/server';
import type { GuideEntry } from '@/content/guides/guides';
import { Link } from '@/i18n/navigation';
import { ROUTES } from '@/lib/site';
import { GuideVisual } from './guide-visual';

/** Card surface shared by grid and featured cards. The title link is stretched over the whole card. */
export const cardClass =
  'border-line-warm bg-surface relative flex overflow-hidden rounded-card border transition-shadow duration-150 hover:shadow-card has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-brand';

export const stretchedLinkClass =
  'text-ink hover:text-ink no-underline after:absolute after:inset-0 hover:no-underline focus-visible:outline-none';

export async function GuideMeta({ guide, className }: { guide: GuideEntry; className?: string }) {
  const t = await getTranslations('guides');
  return (
    <span className={cn('text-muted text-[13px]', className)}>
      {t(`categories.${guide.category}`)} · {t('readingTime', { minutes: guide.readingMinutes })}
    </span>
  );
}

export function guideHref(slug: string) {
  return `${ROUTES.guides}/${slug}`;
}

// design/claude-design/Guides.dc.html — grid card
export async function GuideCard({
  guide,
  headingLevel = 'h3',
}: {
  guide: GuideEntry;
  headingLevel?: 'h2' | 'h3';
}) {
  const Heading = headingLevel;
  return (
    <article className={cn(cardClass, 'h-full flex-col')}>
      <GuideVisual category={guide.category} className="h-[150px] p-3.5 sm:h-[180px]" />
      <div className="flex flex-1 flex-col gap-2.5 p-6">
        <GuideMeta guide={guide} />
        <Heading className="m-0 text-pretty text-xl font-semibold leading-[27px] tracking-[-0.01em]">
          <Link href={guideHref(guide.slug)} className={stretchedLinkClass}>
            {guide.title}
          </Link>
        </Heading>
        <p className="text-muted m-0 text-[15px]">{guide.description}</p>
      </div>
    </article>
  );
}
