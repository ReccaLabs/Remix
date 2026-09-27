import { buttonClass, Logo } from '@remix/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ROUTES } from '@/lib/site';
import { LanguagePill } from './language-switcher';
import { MobileMenu } from './mobile-menu';
import { NavLink } from './nav-link';

/** Primary links (always visible from md up), then the rest (from 1100px, as in the design). */
export const NAV_PRIMARY = [
  { key: 'features', href: ROUTES.features },
  { key: 'pricing', href: ROUTES.pricing },
] as const;

export const NAV_SECONDARY = [
  { key: 'teachers', href: ROUTES.teachers },
  { key: 'institutes', href: ROUTES.institutes },
  { key: 'guides', href: ROUTES.guides },
] as const;

// design/claude-design/Site Header.dc.html
export async function SiteHeader() {
  const t = await getTranslations('common');

  return (
    <header className="bg-paper/92 border-line-warm-soft sticky top-0 z-30 border-b backdrop-blur-[10px]">
      <div className="max-w-marketing mx-auto flex h-[68px] items-center gap-7 px-4 sm:px-6">
        <Link href={ROUTES.home} aria-label={t('a11y.home')} className="flex flex-none">
          <Logo size={26} label="" />
        </Link>

        <nav
          aria-label={t('a11y.mainNav')}
          className="hidden flex-none gap-6 whitespace-nowrap text-[15px] font-medium leading-5 md:flex"
        >
          {NAV_PRIMARY.map((item) => (
            <NavLink key={item.key} href={item.href}>
              {t(`nav.${item.key}`)}
            </NavLink>
          ))}
          {NAV_SECONDARY.map((item) => (
            <NavLink key={item.key} href={item.href} className="hidden min-[1100px]:inline">
              {t(`nav.${item.key}`)}
            </NavLink>
          ))}
        </nav>

        <div className="flex-1" />

        <div className="flex flex-none items-center gap-4 whitespace-nowrap">
          <LanguagePill className="hidden lg:flex" />
          <Link
            href={ROUTES.findClass}
            className="text-ink hover:text-ink hidden text-[15px] font-medium lg:inline"
          >
            {t('nav.findClass')}
          </Link>
          <Link href={ROUTES.trial} className={buttonClass({ size: 'md' })}>
            {t('nav.startFree')}
          </Link>
          <MobileMenu className="min-[1100px]:hidden" />
        </div>
      </div>
    </header>
  );
}
