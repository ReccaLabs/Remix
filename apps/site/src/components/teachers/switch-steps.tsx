import { buttonClass } from '@remix/ui';
import { MessageCircle } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ROUTES, whatsappUrl } from '@/lib/site';
import { StudentPhone } from '../mockups/phones';

const STEPS = ['list', 'setup', 'share'] as const;

/**
 * "Switch in three steps". The design reserves a photo slot on the left; until we have a real,
 * consented classroom photo it shows the student portal mockup (sample data) on the same
 * striped stage, which also illustrates step 3.
 */
export async function SwitchSteps() {
  const t = await getTranslations('teachers.switch');
  const tc = await getTranslations('common.cta');
  const sample = (await getTranslations('common.a11y'))('sampleData');
  const wa = whatsappUrl(t('whatsappPrefill'));

  return (
    <section aria-labelledby="switch-title" className="px-4 pb-16 sm:px-6 sm:pb-24">
      <div className="max-w-marketing mx-auto flex flex-wrap gap-4">
        <figure className="border-line-warm rounded-card relative m-0 flex min-h-[420px] min-w-0 flex-[1_1_460px] items-center justify-center overflow-hidden border bg-[repeating-linear-gradient(135deg,var(--color-paper-2)_0_10px,var(--color-paper-3)_10px_20px)] px-5 pb-16 pt-8">
          <figcaption className="sr-only">{t('mockupLabel')}</figcaption>
          <StudentPhone />
          <span
            aria-hidden
            className="border-line-warm bg-surface text-muted rounded-xs absolute bottom-5 left-5 border px-2.5 py-1 font-mono text-[13px]"
          >
            {sample}
          </span>
        </figure>

        <div className="bg-brand-soft rounded-card flex min-w-0 flex-[1_1_460px] flex-col gap-7 p-6 sm:p-12">
          <h2
            id="switch-title"
            className="font-display m-0 text-balance text-[30px] font-bold leading-[1.08] tracking-[-0.025em] sm:text-[38px]"
          >
            {t('title')}
          </h2>
          <ol className="m-0 flex list-none flex-col gap-5 p-0">
            {STEPS.map((key, i) => (
              <li key={key} className="flex gap-4">
                <span
                  aria-hidden
                  className="bg-ink flex size-8 flex-none items-center justify-center rounded-full text-sm font-semibold text-white"
                >
                  {i + 1}
                </span>
                <div className="flex flex-col">
                  <h3 className="m-0 text-base font-semibold">{t(`steps.${key}.title`)}</h3>
                  <p className="text-ink-2 m-0 text-pretty">{t(`steps.${key}.body`)}</p>
                </div>
              </li>
            ))}
          </ol>
          {wa ? (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass({ className: 'self-start' })}
            >
              <MessageCircle size={18} aria-hidden />
              {t('whatsapp')}
            </a>
          ) : (
            <Link href={ROUTES.demo} className={buttonClass({ className: 'self-start' })}>
              {tc('bookDemo')}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
