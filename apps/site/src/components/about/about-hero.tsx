import { Container, DisplayHeading, Eyebrow, Logo } from '@remix/ui';
import { getTranslations } from 'next-intl/server';

// design/claude-design/About.dc.html — intro + team photo
export async function AboutHero() {
  const t = await getTranslations('about.hero');

  return (
    <section aria-labelledby="about-title">
      <Container className="flex flex-wrap items-end gap-6 pb-12 pt-12 sm:gap-14 sm:pb-[72px] sm:pt-[72px]">
        <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-5">
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <DisplayHeading as="h1" id="about-title" size="xl">
            {t('title')}
          </DisplayHeading>
        </div>
        <p className="text-ink-2 m-0 min-w-0 flex-[1_1_320px] text-pretty text-lg leading-7">
          {t('intro')}
        </p>
      </Container>

      <Container className="pb-16 sm:pb-24">
        {/*
          Placeholder for the design's team photo ("the Recca Labs team with pilot teachers").
          Kept neutral and decorative until a real, consented photo exists (DESIGN.md §2.5).
        */}
        <div
          aria-hidden
          className="border-line-warm rounded-card flex h-[240px] items-end border bg-[repeating-linear-gradient(135deg,var(--color-paper-2)_0_10px,var(--color-paper-3)_10px_20px)] p-5 sm:h-[360px] lg:h-[440px]"
        >
          <span className="border-line-warm bg-surface flex rounded-md border p-2">
            <Logo variant="mark" size={32} label="" />
          </span>
        </div>
      </Container>
    </section>
  );
}
