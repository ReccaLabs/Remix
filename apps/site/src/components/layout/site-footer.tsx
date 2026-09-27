import { Logo } from '@remix/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ROUTES, whatsappUrl } from '@/lib/site';
import { LanguageList } from './language-switcher';

// design/claude-design/Site Footer.dc.html
export async function SiteFooter() {
  const t = await getTranslations('common');
  const wa = whatsappUrl(t('cta.whatsappPrefill'));

  const columns = [
    {
      title: t('footer.product'),
      links: [
        { label: t('nav.features'), href: ROUTES.features },
        { label: t('nav.pricing'), href: ROUTES.pricing },
        { label: t('nav.teachers'), href: ROUTES.teachers },
        { label: t('nav.institutes'), href: ROUTES.institutes },
        { label: t('nav.findClass'), href: ROUTES.findClass },
      ],
    },
    {
      title: t('footer.company'),
      links: [
        { label: t('footer.aboutCompany'), href: ROUTES.about },
        { label: t('nav.guides'), href: ROUTES.guides },
        { label: t('cta.bookDemo'), href: ROUTES.demo },
      ],
    },
    {
      title: t('footer.legal'),
      links: [
        { label: t('footer.privacy'), href: ROUTES.privacy },
        { label: t('footer.terms'), href: ROUTES.terms },
        { label: t('footer.dataProtection'), href: ROUTES.dataProtection },
      ],
    },
  ];

  const linkClass = 'text-night-muted hover:text-white';

  return (
    <footer className="bg-night text-night-muted text-[15px] leading-6">
      <div className="max-w-marketing mx-auto flex flex-col gap-12 px-4 pb-8 pt-16 sm:px-6">
        <div className="flex flex-wrap justify-between gap-12">
          <div className="flex flex-[1_1_280px] flex-col gap-4">
            <Logo variant="lockup" tone="dark" size={32} label="ReMix by Recca Labs" />
            <p className="m-0 max-w-[300px]">{t('footer.tagline')}</p>
          </div>
          <nav aria-label={t('a11y.footerNav')} className="flex flex-wrap gap-x-16 gap-y-10">
            {columns.map((col) => (
              <div key={col.title} className="flex flex-col gap-2.5">
                <h2 className="m-0 mb-1 text-[15px] font-semibold text-white">{col.title}</h2>
                <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className={linkClass}>
                        {l.label}
                      </Link>
                    </li>
                  ))}
                  {col.title === t('footer.company') && wa && (
                    <li>
                      <a href={wa} target="_blank" rel="noopener noreferrer" className={linkClass}>
                        {t('footer.whatsapp')}
                      </a>
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="border-night-line flex flex-wrap items-center justify-between gap-4 border-t pt-6 text-sm">
          <span>{t('footer.copyright', { year: new Date().getFullYear() })}</span>
          <LanguageList tone="dark" />
        </div>
      </div>
    </footer>
  );
}
