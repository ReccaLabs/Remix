import { Container } from '@remix/ui';
import { getTranslations } from 'next-intl/server';
import { GUIDE_CATEGORIES, type GuideCategory, type GuideEntry } from '@/content/guides/guides';
import { GuideCard } from './guide-card';

/**
 * Topic filter without client JS: native radio pills + CSS `:has()`. When a topic radio is
 * checked, cards of other topics are hidden. Browsers without `:has()` simply show every card.
 * Class strings are written out in full so Tailwind can see them.
 */
const HIDE_OTHERS: Record<GuideCategory, string> = {
  gettingStarted:
    '[&:has(input[value=gettingStarted]:checked)_li[data-cat]:not([data-cat=gettingStarted])]:hidden',
  onlineClasses:
    '[&:has(input[value=onlineClasses]:checked)_li[data-cat]:not([data-cat=onlineClasses])]:hidden',
  fees: '[&:has(input[value=fees]:checked)_li[data-cat]:not([data-cat=fees])]:hidden',
  protectingLessons:
    '[&:has(input[value=protectingLessons]:checked)_li[data-cat]:not([data-cat=protectingLessons])]:hidden',
  attendance:
    '[&:has(input[value=attendance]:checked)_li[data-cat]:not([data-cat=attendance])]:hidden',
};

// design/claude-design/Guides.dc.html — topic pills + card grid
export async function GuideList({ guides }: { guides: readonly GuideEntry[] }) {
  const t = await getTranslations('guides');
  // Only offer topics that have at least one guide, in the design's order.
  const topics = GUIDE_CATEGORIES.filter((c) => guides.some((g) => g.category === c));

  return (
    <section aria-labelledby="guide-list-title">
      <h2 id="guide-list-title" className="sr-only">
        {t('listLabel')}
      </h2>
      <Container
        className={[
          'flex flex-col gap-6 pb-16 sm:pb-24',
          ...topics.map((c) => HIDE_OTHERS[c]),
        ].join(' ')}
      >
        {topics.length > 1 && (
          <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
            <legend className="sr-only">{t('filterLabel')}</legend>
            {(['all', ...topics] as const).map((c) => (
              <label key={c} className="relative">
                <input
                  type="radio"
                  name="guide-topic"
                  value={c}
                  defaultChecked={c === 'all'}
                  className="peer sr-only"
                />
                <span className="border-line-warm bg-surface text-ink hover:border-ink peer-checked:border-ink peer-checked:bg-ink peer-focus-visible:outline-brand flex h-11 cursor-pointer items-center rounded-full border px-4 text-[15px] font-medium transition-colors duration-150 peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 sm:h-10">
                  {t(`categories.${c}`)}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-4 p-0">
          {guides.map((g) => (
            <li key={g.slug} data-cat={g.category}>
              <GuideCard guide={g} />
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
