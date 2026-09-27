import { Container, DisplayHeading } from '@remix/ui';
import { getTranslations } from 'next-intl/server';

const ITEMS = ['slips', 'cash', 'halls', 'reports'] as const;

export async function CounterRush() {
  const t = await getTranslations('institutes.rush');

  return (
    <section aria-labelledby="rush-title" className="bg-night text-white">
      <Container className="flex flex-col gap-12 py-16 sm:py-[88px]">
        <DisplayHeading id="rush-title" className="max-w-[720px]">
          {t('title')}
        </DisplayHeading>
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-x-10 gap-y-8 p-0">
          {ITEMS.map((key) => (
            <li key={key} className="border-night-line flex flex-col gap-2 border-t pt-5">
              <h3 className="m-0 text-lg font-semibold">{t(`items.${key}.title`)}</h3>
              <p className="text-night-muted m-0 text-pretty">{t(`items.${key}.body`)}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
