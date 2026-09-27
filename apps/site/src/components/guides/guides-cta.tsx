import { buttonClass } from '@remix/ui';
import { MessageCircle } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ROUTES, whatsappUrl } from '@/lib/site';

/**
 * Dark "Want us to set it up for you?" band (design/claude-design/Guides.dc.html).
 * `secondary`: WhatsApp (falls back to demo when no number is configured) or Book a demo.
 */
export async function GuidesCta({ secondary = 'whatsapp' }: { secondary?: 'whatsapp' | 'demo' }) {
  const t = await getTranslations('guides.cta');
  const tc = await getTranslations('common.cta');
  const wa = secondary === 'whatsapp' ? whatsappUrl(tc('whatsappPrefill')) : null;
  const outline = buttonClass({
    variant: 'outline',
    className: 'border-ink-2 text-white hover:bg-night-2 hover:text-white',
  });

  return (
    <section aria-labelledby="guides-cta-title" className="px-4 pb-16 sm:px-6 sm:pb-24">
      <div className="bg-night max-w-marketing rounded-band mx-auto flex flex-wrap items-center justify-between gap-8 px-6 py-10 text-white sm:p-14">
        <div className="flex max-w-[560px] flex-col gap-2">
          <h2
            id="guides-cta-title"
            className="font-display m-0 text-balance text-[28px] font-bold leading-[1.1] tracking-[-0.025em] sm:text-4xl sm:leading-[1.1]"
          >
            {t('title')}
          </h2>
          <p className="text-night-muted m-0">{t('body')}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href={ROUTES.trial} className={buttonClass()}>
            {tc('startTrial')}
          </Link>
          {wa ? (
            <a href={wa} target="_blank" rel="noopener noreferrer" className={outline}>
              <MessageCircle size={18} aria-hidden />
              {t('whatsapp')}
            </a>
          ) : (
            <Link href={ROUTES.demo} className={outline}>
              {tc('bookDemo')}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
