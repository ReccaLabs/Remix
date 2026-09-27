import { buttonClass, Container, DisplayHeading, Eyebrow } from '@remix/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ROUTES } from '@/lib/site';

export async function InstitutesHero() {
  const t = await getTranslations('institutes.hero');
  const tc = await getTranslations('common.cta');

  return (
    <section aria-labelledby="institutes-title">
      <Container className="flex flex-col gap-6 pb-12 pt-12 sm:pb-16 sm:pt-[72px]">
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <DisplayHeading
          as="h1"
          id="institutes-title"
          size="xl"
          className="max-w-[900px] lg:text-[68px]"
        >
          {t('title')}
        </DisplayHeading>
        <p className="text-ink-2 m-0 max-w-[620px] text-pretty text-lg leading-7">
          {t('subtitle')}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href={ROUTES.demo} className={buttonClass()}>
            {tc('bookDemo')}
          </Link>
          <Link href={ROUTES.trial} className={buttonClass({ variant: 'outline' })}>
            {tc('startTrial')}
          </Link>
        </div>
      </Container>
    </section>
  );
}
