import { buttonClass, DisplayHeading, Eyebrow } from '@remix/ui';
import { Mail, MessageCircle } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ROUTES, SITE } from '@/lib/site';

const STEPS = ['contact', 'learn', 'try'] as const;

/** Left column of /demo: short value copy, what happens next, other ways to reach us. */
export async function DemoIntro({ whatsappHref }: { whatsappHref: string | null }) {
  const t = await getTranslations('demo.intro');
  const tc = await getTranslations('common.cta');

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <DisplayHeading as="h1" size="lg">
          {t('title')}
        </DisplayHeading>
        <p className="text-ink-2 m-0 max-w-[480px] text-pretty text-lg leading-7">{t('body')}</p>
      </div>

      <section aria-labelledby="demo-next-title" className="flex flex-col gap-4">
        <h2 id="demo-next-title" className="m-0 text-lg font-semibold">
          {t('nextTitle')}
        </h2>
        <ol className="m-0 flex list-none flex-col gap-5 p-0">
          {STEPS.map((key, i) => (
            <li key={key} className="flex gap-4">
              <span
                aria-hidden
                className="bg-brand-soft text-brand tabular flex size-9 flex-none items-center justify-center rounded-full font-semibold"
              >
                {i + 1}
              </span>
              <div className="flex flex-col gap-0.5 pt-1.5">
                <h3 className="m-0 text-base font-semibold">{t(`steps.${key}.title`)}</h3>
                <p className="text-ink-2 m-0 max-w-[420px] text-[15px] leading-6">
                  {t(`steps.${key}.body`)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section
        aria-labelledby="demo-contact-title"
        className="border-line-warm flex flex-col gap-3 border-t pt-6"
      >
        <h2 id="demo-contact-title" className="m-0 text-base font-semibold">
          {t('contactTitle')}
        </h2>
        <div className="flex flex-wrap gap-3">
          {whatsappHref ? (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass({ variant: 'outline', size: 'lg' })}
            >
              <MessageCircle size={18} aria-hidden />
              {tc('whatsapp')}
            </a>
          ) : null}
          <a
            href={`mailto:${SITE.email.sales}`}
            className={buttonClass({ variant: 'ghost', size: 'lg', className: 'px-3' })}
          >
            <Mail size={18} aria-hidden />
            {t('email', { email: SITE.email.sales })}
          </a>
        </div>
        <p className="text-muted m-0 text-sm">
          {t.rich('student', {
            link: (chunks) => (
              <Link href={ROUTES.findClass} className="font-medium">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </section>
    </div>
  );
}
