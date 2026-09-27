import { Container, DisplayHeading, Eyebrow } from '@remix/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { DashboardPreview } from '../mockups/dashboard-preview';
import { ParentPhone, StudentPhone } from '../mockups/phones';
import { Scaled } from '../mockups/scaled';
import { Tabs } from './tabs';

function Frame({
  caption,
  sample,
  children,
}: {
  caption: string;
  sample: string;
  children: ReactNode;
}) {
  return (
    <figure className="m-0 flex flex-col gap-3">
      <div className="border-line-warm bg-surface shadow-card rounded-card overflow-hidden border">
        {children}
      </div>
      <figcaption className="text-muted flex flex-wrap justify-between gap-2 text-sm">
        <span>{caption}</span>
        <span className="font-mono text-[13px]">{sample}</span>
      </figcaption>
    </figure>
  );
}

const phoneStage =
  'flex h-[520px] items-center justify-center gap-8 bg-[repeating-linear-gradient(135deg,var(--color-paper-2)_0_10px,var(--color-paper)_10px_20px)]';

export async function ScreensTour() {
  const t = await getTranslations('home.tour');
  const sample = (await getTranslations('common.a11y'))('sampleData');

  return (
    <section aria-labelledby="tour-title">
      <Container className="flex flex-col gap-8 pb-16 sm:pb-24">
        <div className="flex flex-col gap-3">
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <DisplayHeading id="tour-title">{t('title')}</DisplayHeading>
        </div>
        <Tabs
          label={t('tabsLabel')}
          className="-mt-2"
          items={[
            {
              id: 'admin',
              label: t('tabs.admin'),
              panel: (
                <Frame caption={t('captions.admin')} sample={sample}>
                  {/* 1440×750 crop of the dashboard, scaled to the container at each breakpoint */}
                  <Scaled
                    width={1440}
                    height={750}
                    className="pointer-events-none [--s:0.23] min-[400px]:[--s:0.245] sm:[--s:0.42] md:[--s:0.5] lg:[--s:0.675] xl:[--s:0.8]"
                  >
                    <DashboardPreview />
                  </Scaled>
                </Frame>
              ),
            },
            {
              id: 'student',
              label: t('tabs.student'),
              panel: (
                <Frame caption={t('captions.student')} sample={sample}>
                  <div className={phoneStage}>
                    <StudentPhone />
                  </div>
                </Frame>
              ),
            },
            {
              id: 'parent',
              label: t('tabs.parent'),
              panel: (
                <Frame caption={t('captions.parent')} sample={sample}>
                  <div className={phoneStage}>
                    <ParentPhone />
                  </div>
                </Frame>
              ),
            },
          ]}
        />
      </Container>
    </section>
  );
}
