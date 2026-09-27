import { buttonClass, Container, DisplayHeading, Logo } from '@remix/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ROUTES, SITE, whatsappUrl } from '@/lib/site';

// design/claude-design/About.dc.html — pilot invitation + company facts card
export async function Pilot() {
  const t = await getTranslations('about.pilot');
  const tc = await getTranslations('common.cta');
  const wa = whatsappUrl(tc('whatsappPrefill'));

  const rows = [
    { term: t('basedIn'), value: t('basedInValue') },
    { term: t('product'), value: t('productValue') },
    {
      term: t('talk'),
      // No WhatsApp number configured (e.g. local dev) → fall back to the hello@ address.
      value: wa ? (
        <a href={wa} target="_blank" rel="noopener noreferrer" className="font-medium">
          {t('whatsapp')}
        </a>
      ) : (
        <a href={`mailto:${SITE.email.hello}`} className="break-all font-medium">
          {SITE.email.hello}
        </a>
      ),
    },
  ];

  return (
    <section aria-labelledby="pilot-title">
      <Container className="flex flex-wrap items-center gap-12 py-16 sm:py-24">
        <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-5">
          <DisplayHeading id="pilot-title" className="lg:text-[44px]">
            {t('title')}
          </DisplayHeading>
          <p className="text-ink-2 m-0 text-pretty">{t('body')}</p>
          <Link href={ROUTES.demo} className={buttonClass({ className: 'self-start' })}>
            {t('cta')}
          </Link>
        </div>

        <div className="border-line-warm bg-surface rounded-card flex min-w-0 flex-[1_1_440px] flex-col items-start gap-6 border p-6 sm:p-10">
          <Logo variant="lockup" size={48} label={`${SITE.name} by ${SITE.company}`} />
          <dl aria-label={t('factsLabel')} className="m-0 flex w-full flex-col gap-3">
            {rows.map((row) => (
              <div
                key={row.term}
                className="border-line-warm-soft flex flex-wrap justify-between gap-x-4 gap-y-1 border-t py-3"
              >
                <dt className="text-muted">{row.term}</dt>
                <dd className="m-0 font-medium">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Container>
    </section>
  );
}
