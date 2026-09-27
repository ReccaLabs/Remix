import { buttonClass, Container } from '@remix/ui';
import { ArrowRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ROUTES } from '@/lib/site';
import { DashboardPreview } from '../mockups/dashboard-preview';
import { StudentPhone } from '../mockups/phones';
import { Scaled } from '../mockups/scaled';

export async function Hero() {
  const t = await getTranslations('home.hero');
  const tc = await getTranslations('common.cta');

  return (
    <section id="top">
      <Container className="flex flex-col items-center gap-12 pb-16 pt-12 sm:pb-[88px] sm:pt-[72px] xl:flex-row">
        <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-6 self-stretch">
          <Link
            href={ROUTES.features}
            className="border-line-warm bg-surface text-ink hover:text-ink inline-flex h-8 items-center gap-2 self-start rounded-full border pl-1 pr-3 text-[13px] font-medium no-underline hover:no-underline"
          >
            <span className="bg-accent-soft text-accent-ink flex h-6 items-center rounded-full px-2 font-semibold">
              {t('pillBadge')}
            </span>
            <span className="truncate">{t('pill')}</span>
            <ArrowRight size={14} aria-hidden className="flex-none" />
          </Link>

          <h1 className="font-display lg:text-display-xl m-0 text-balance text-[42px] font-extrabold leading-[1.02] tracking-[-0.035em] sm:text-[56px]">
            {t.rich('title', { accent: (chunks) => <span className="text-brand">{chunks}</span> })}
          </h1>

          <p className="text-ink-2 m-0 max-w-[520px] text-pretty text-lg leading-7">
            {t('subtitle')}
          </p>

          <div className="flex flex-wrap gap-3">
            <Link href={ROUTES.trial} className={buttonClass()}>
              {tc('startTrial')}
              <ArrowRight size={16} aria-hidden />
            </Link>
            <Link href={ROUTES.demo} className={buttonClass({ variant: 'outline' })}>
              {tc('bookDemo')}
            </Link>
          </div>

          <ul className="text-muted m-0 flex list-none flex-wrap gap-x-[18px] gap-y-1.5 p-0 text-sm">
            <li>
              {t.rich('fromPrice', { b: (c) => <b className="text-ink font-semibold">{c}</b> })}
            </li>
            <li>{t('migration')}</li>
            <li>{t('languages')}</li>
          </ul>
        </div>

        <figure className="m-0 flex-none">
          <figcaption className="sr-only">{t('mockupLabel')}</figcaption>
          <Scaled
            width={640}
            height={500}
            className="[--s:0.5] min-[400px]:[--s:0.55] sm:[--s:0.9] md:[--s:1]"
          >
            <div className="relative h-[500px] w-[640px]">
              <div className="border-line-warm bg-surface shadow-card absolute left-0 top-3 w-[600px] overflow-hidden rounded-lg border">
                <div
                  aria-hidden
                  className="bg-paper-3 border-line-warm-soft flex h-8 items-center gap-2.5 border-b px-3"
                >
                  <div className="flex gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="bg-line-warm size-[9px] rounded-full" />
                    ))}
                  </div>
                  <div className="border-line-warm bg-surface text-muted mx-auto h-5 w-full max-w-[280px] rounded-[6px] border text-center font-mono text-[11px] leading-[18px]">
                    kamalphysics.remix.lk/admin
                  </div>
                </div>
                <Scaled width={1440} height={960} className="pointer-events-none [--s:0.4167]">
                  <DashboardPreview />
                </Scaled>
              </div>
              <StudentPhone className="absolute right-0 top-10" />
            </div>
          </Scaled>
        </figure>
      </Container>
    </section>
  );
}
