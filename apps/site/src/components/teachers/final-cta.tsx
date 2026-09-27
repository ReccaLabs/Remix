import { buttonClass, DisplayHeading } from '@remix/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ROUTES } from '@/lib/site';

export async function TeachersFinalCta() {
  const t = await getTranslations('teachers.finalCta');
  const tc = await getTranslations('common.cta');

  return (
    <section aria-labelledby="teachers-cta-title" className="px-4 pb-16 sm:px-6 sm:pb-24">
      <div className="border-line-warm bg-surface max-w-marketing rounded-band mx-auto flex flex-wrap items-center justify-between gap-8 border px-6 py-12 sm:px-14 sm:py-16">
        <div className="flex min-w-0 max-w-[620px] flex-col gap-2.5">
          <DisplayHeading
            id="teachers-cta-title"
            size="lg"
            className="leading-[1.05] tracking-[-0.03em] lg:text-[44px]"
          >
            {t('title')}
          </DisplayHeading>
          <p className="text-muted m-0">
            {t.rich('institutes', {
              link: (chunks) => (
                <Link href={ROUTES.institutes} className="font-medium">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>
        <Link href={ROUTES.trial} className={buttonClass({ size: 'xl' })}>
          {tc('startTrial')}
        </Link>
      </div>
    </section>
  );
}
