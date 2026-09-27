import { Container, DisplayHeading } from '@remix/ui';
import { getTranslations } from 'next-intl/server';

const ITEMS = ['gate', 'zoom', 'recording', 'sms', 'slips'] as const;

/** "A Saturday with ReMix" timeline on the dark band. */
export async function Saturday() {
  const t = await getTranslations('teachers.saturday');

  return (
    <section aria-labelledby="saturday-title" className="bg-night text-white">
      <Container className="flex flex-wrap gap-10 py-16 sm:py-[88px] lg:gap-14">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          <DisplayHeading id="saturday-title">{t('title')}</DisplayHeading>
          <p className="text-night-muted m-0 max-w-[360px] text-pretty">{t('subtitle')}</p>
        </div>
        <ol className="border-night-line m-0 flex min-w-0 flex-[2_1_560px] list-none flex-col border-b p-0">
          {ITEMS.map((key) => (
            <li
              key={key}
              className="border-night-line grid grid-cols-[72px_minmax(0,1fr)] gap-4 border-t py-5 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-6"
            >
              <span className="text-accent-on-dark pt-0.5 font-mono text-sm">
                {t(`items.${key}.time`)}
              </span>
              <div className="flex flex-col gap-1">
                <h3 className="m-0 text-lg font-semibold">{t(`items.${key}.title`)}</h3>
                <p className="text-night-muted m-0 text-pretty">{t(`items.${key}.body`)}</p>
              </div>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
