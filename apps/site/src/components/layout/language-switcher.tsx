import { cn } from '@remix/ui';
import { getLocale, getTranslations } from 'next-intl/server';
import { isLiveLocale, LANGUAGES } from '@/i18n/routing';

/**
 * "EN · සිං · த" pill from the header design. Languages that aren't live yet render as
 * disabled text with a "coming soon" label; once a locale is added to routing.locales it
 * becomes a link to the same site in that language.
 */
export async function LanguagePill({ className }: { className?: string }) {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('common.a11y')]);

  return (
    <nav
      aria-label={t('language')}
      className={cn(
        'border-line-warm text-ink-2 h-[30px] items-center gap-1.5 rounded-full border px-2.5 text-[13px]',
        className,
      )}
    >
      {LANGUAGES.map((lang, i) => (
        <span key={lang.code} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>·</span>}
          <LanguageItem
            code={lang.code}
            current={locale}
            className={lang.font}
            soon={t('comingSoon')}
          >
            {lang.short}
          </LanguageItem>
        </span>
      ))}
    </nav>
  );
}

/** Full-name list used in the footer and mobile menu ("English  සිංහල  தமிழ்"). */
export async function LanguageList({
  className,
  tone = 'light',
}: {
  className?: string;
  tone?: 'light' | 'dark';
}) {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('common.a11y')]);

  return (
    <nav aria-label={t('language')} className={cn('flex items-center gap-2.5', className)}>
      {LANGUAGES.map((lang) => (
        <LanguageItem
          key={lang.code}
          code={lang.code}
          current={locale}
          soon={t('comingSoon')}
          className={cn(lang.font, tone === 'dark' && lang.code === locale && 'text-white')}
        >
          {lang.label}
        </LanguageItem>
      ))}
    </nav>
  );
}

function LanguageItem({
  code,
  current,
  soon,
  className,
  children,
}: {
  code: string;
  current: string;
  soon: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (code === current) {
    return (
      <span lang={code} aria-current="true" className={cn('text-ink font-semibold', className)}>
        {children}
      </span>
    );
  }
  if (isLiveLocale(code)) {
    // Plain anchor: switching language is a full page load of the static export.
    return (
      <a lang={code} hrefLang={code} href={`/${code}/`} className={cn('text-inherit', className)}>
        {children}
      </a>
    );
  }
  return (
    <span lang={code} title={soon} className={cn('cursor-default opacity-80', className)}>
      {children}
      <span className="sr-only"> ({soon})</span>
    </span>
  );
}
