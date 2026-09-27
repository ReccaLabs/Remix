import { buttonClass, DisplayHeading, Logo } from '@remix/ui';
import { MessageCircle } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ROUTES, whatsappUrl } from '@/lib/site';

export async function FinalCta() {
  const t = await getTranslations('home.finalCta');
  const tc = await getTranslations('common.cta');
  const wa = whatsappUrl(tc('whatsappPrefill'));
  const outline = buttonClass({ variant: 'outline', size: 'xl' });

  return (
    <section aria-labelledby="final-cta-title" className="px-4 pb-16 sm:px-6 sm:pb-24">
      <div className="border-line-warm bg-surface max-w-marketing rounded-band mx-auto flex flex-col items-center gap-6 border px-6 py-14 text-center sm:px-14 sm:py-[72px]">
        <Logo variant="mark" size={56} label="" />
        <DisplayHeading id="final-cta-title" size="lg" className="max-w-[780px]">
          {t('title')}
        </DisplayHeading>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href={ROUTES.trial} className={buttonClass({ size: 'xl' })}>
            {tc('startTrial')}
          </Link>
          {wa ? (
            <a href={wa} target="_blank" rel="noopener noreferrer" className={outline}>
              <MessageCircle size={18} aria-hidden />
              {tc('whatsapp')}
            </a>
          ) : (
            <Link href={ROUTES.demo} className={outline}>
              {tc('bookDemo')}
            </Link>
          )}
        </div>
        <span className="text-muted text-sm">{t('note')}</span>
      </div>
    </section>
  );
}
