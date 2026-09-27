import { Container, DisplayHeading } from '@remix/ui';
import { getTranslations } from 'next-intl/server';

// design/claude-design/About.dc.html — "Why we built ReMix"
export async function Story() {
  const t = await getTranslations('about.story');

  return (
    <section aria-labelledby="story-title">
      <Container className="flex flex-wrap gap-6 pb-16 sm:gap-14 sm:pb-24">
        <div className="min-w-0 flex-[1_1_320px]">
          <DisplayHeading id="story-title" className="lg:text-[44px]">
            {t('title')}
          </DisplayHeading>
        </div>
        <div className="text-ink-2 flex min-w-0 flex-[2_1_560px] flex-col gap-5 text-lg leading-[30px]">
          <p className="m-0 text-pretty">{t('p1')}</p>
          <p className="m-0 text-pretty">{t('p2')}</p>
        </div>
      </Container>
    </section>
  );
}
