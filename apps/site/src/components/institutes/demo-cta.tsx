import { buttonClass, DisplayHeading } from '@remix/ui';
import { ArrowRight, Check, MessageCircle } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ROUTES, whatsappUrl } from '@/lib/site';

const POINTS = ['call', 'place', 'own'] as const;

/**
 * The design shows an inline demo form here. The real form lives at /demo, so this band links
 * to it instead of duplicating the form (and its Turnstile/validation) on this page.
 */
export async function DemoCta() {
  const t = await getTranslations('institutes.demo');
  const tc = await getTranslations('common.cta');
  const wa = whatsappUrl(tc('whatsappPrefill'));

  return (
    <section id="demo" aria-labelledby="demo-title" className="px-4 pb-16 sm:px-6 sm:pb-24">
      <div className="bg-brand-soft max-w-marketing rounded-band mx-auto flex flex-wrap gap-8 p-6 sm:gap-12 sm:p-10 lg:p-14">
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-4">
          <DisplayHeading id="demo-title">{t('title')}</DisplayHeading>
          <p className="text-ink-2 m-0 max-w-[400px] text-pretty">{t('body')}</p>
        </div>

        <div className="bg-surface rounded-card flex min-w-0 flex-[1_1_440px] flex-col gap-5 p-6 sm:p-7">
          <h3 className="m-0 text-lg font-semibold">{t('cardTitle')}</h3>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {POINTS.map((key) => (
              <li key={key} className="flex gap-3">
                <span
                  aria-hidden
                  className="bg-success-soft text-success-ink mt-px flex size-[22px] flex-none items-center justify-center rounded-full"
                >
                  <Check size={14} strokeWidth={2.5} />
                </span>
                <span className="text-ink-2">{t(`points.${key}`)}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <Link href={ROUTES.demo} className={buttonClass()}>
              {t('cta')}
              <ArrowRight size={16} aria-hidden />
            </Link>
            {wa && (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({ variant: 'outline' })}
              >
                <MessageCircle size={18} aria-hidden />
                {tc('whatsapp')}
              </a>
            )}
          </div>
          <p className="text-muted m-0 text-sm">{t('note')}</p>
          <p className="text-muted border-line m-0 border-t pt-4 text-sm">
            {t.rich('trial', {
              link: (chunks) => (
                <Link href={ROUTES.trial} className="font-medium">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>
      </div>
    </section>
  );
}
