import { Container, DisplayHeading } from '@remix/ui';
import { getTranslations } from 'next-intl/server';

const ITEMS = ['trust', 'fast', 'phone', 'languages'] as const;

// design/claude-design/About.dc.html — dark "What we hold ourselves to" band
export async function Values() {
  const t = await getTranslations('about.values');

  return (
    <section className="bg-night text-white" aria-labelledby="values-title">
      <Container className="flex flex-col gap-12 py-16 sm:py-[88px]">
        <DisplayHeading id="values-title">{t('title')}</DisplayHeading>
        <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-x-10 gap-y-8 p-0">
          {ITEMS.map((key, i) => (
            <li key={key} className="border-night-line flex flex-col gap-2.5 border-t pt-5">
              <span aria-hidden className="text-accent-on-dark font-mono text-[13px]">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="m-0 text-xl font-semibold leading-7">{t(`items.${key}.title`)}</h3>
              <p className="text-night-muted m-0 text-pretty">{t(`items.${key}.body`)}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
