import { Container } from '@remix/ui';
import { getTranslations } from 'next-intl/server';

const ITEMS = ['leaks', 'sharing', 'fees'] as const;

export async function Problems() {
  const t = await getTranslations('home.problems');

  return (
    <section className="bg-night text-white" aria-labelledby="problems-title">
      <Container className="flex flex-col gap-12 py-16 sm:py-[88px]">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <h2
            id="problems-title"
            className="font-display lg:text-display m-0 max-w-[640px] text-balance text-[32px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[40px]"
          >
            {t('title')}
          </h2>
          <p className="text-night-muted m-0 max-w-[360px]">{t('subtitle')}</p>
        </div>
        <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-4 p-0">
          {ITEMS.map((key, i) => (
            <li
              key={key}
              className="border-night-line bg-night-2 rounded-card flex flex-col gap-4 border p-7"
            >
              <span aria-hidden className="text-accent-on-dark font-mono text-[13px]">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="m-0 text-[22px] font-semibold leading-7 tracking-[-0.01em]">
                {t(`items.${key}.title`)}
              </h3>
              <p className="text-night-muted m-0 text-pretty">{t(`items.${key}.body`)}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
