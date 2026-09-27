import { cn, Container, DisplayHeading } from '@remix/ui';
import { Check, Minus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

const ITEMS = [
  { key: 'counts', tone: 'bg-success-soft text-success-ink', Icon: Check },
  { key: 'free', tone: 'bg-line-soft text-ink-2', Icon: Minus },
  { key: 'example', tone: 'bg-brand-soft text-brand', Icon: null },
] as const;

const bold = (chunks: ReactNode) => <b className="text-ink font-semibold">{chunks}</b>;

/** "What counts as an active student?" explainer: three cards, each with a word + icon badge. */
export async function ActiveStudents() {
  const t = await getTranslations('pricing.active');

  return (
    <section aria-labelledby="active-title">
      <Container className="flex flex-col gap-8 pb-16 sm:pb-24">
        <div className="flex max-w-[680px] flex-col gap-3">
          <DisplayHeading id="active-title" className="lg:text-[44px]">
            {t('title')}
          </DisplayHeading>
          <p className="text-ink-2 m-0 text-pretty">{t('subtitle')}</p>
        </div>
        <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
          {ITEMS.map(({ key, tone, Icon }) => (
            <li
              key={key}
              className="bg-surface border-line-warm rounded-card flex flex-col gap-3.5 border p-6 sm:p-7"
            >
              <span
                className={cn(
                  'rounded-xs inline-flex h-[26px] items-center gap-1.5 self-start px-2.5 text-[13px] font-semibold',
                  tone,
                )}
              >
                {Icon && <Icon size={14} strokeWidth={2.5} aria-hidden />}
                {t(`${key}.badge`)}
              </span>
              <p className="text-ink-2 m-0">{t.rich(`${key}.body`, { b: bold })}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
