'use client';

import { buttonClass, cn } from '@remix/ui';
import { Menu, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { LANGUAGES } from '@/i18n/routing';
import { ROUTES } from '@/lib/site';

const LINKS = [
  { key: 'features', href: ROUTES.features },
  { key: 'pricing', href: ROUTES.pricing },
  { key: 'teachers', href: ROUTES.teachers },
  { key: 'institutes', href: ROUTES.institutes },
  { key: 'guides', href: ROUTES.guides },
  { key: 'about', href: ROUTES.about },
  { key: 'findClass', href: ROUTES.findClass },
] as const;

/** Disclosure menu for < 1100px. Closes on navigation, Escape and outside click. */
export function MobileMenu({ className }: { className?: string }) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close whenever the route changes.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div className={className}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? t('a11y.closeMenu') : t('a11y.openMenu')}
        onClick={() => setOpen((v) => !v)}
        className="text-ink hover:bg-paper-2 -mr-2 flex size-11 items-center justify-center rounded-md"
      >
        {open ? <X size={22} aria-hidden /> : <Menu size={22} aria-hidden />}
      </button>

      <div
        ref={panelRef}
        id={panelId}
        hidden={!open}
        className="bg-paper border-line-warm-soft shadow-card absolute inset-x-0 top-full border-b"
      >
        <nav
          aria-label={t('a11y.mainNav')}
          className="max-w-marketing mx-auto flex flex-col px-4 py-3 sm:px-6"
        >
          {LINKS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              onClick={() => setOpen(false)}
              className="text-ink border-line-warm-soft flex min-h-12 items-center border-b text-base font-medium no-underline last:border-0 hover:no-underline"
            >
              {t(`nav.${item.key}`)}
            </Link>
          ))}
          <div className="text-ink-2 flex items-center gap-3 py-3 text-sm">
            {LANGUAGES.map((lang, i) => (
              <span
                key={lang.code}
                lang={lang.code}
                className={cn(lang.font, i === 0 ? 'text-ink font-semibold' : 'opacity-80')}
              >
                {lang.label}
                {i > 0 && <span className="sr-only"> ({t('a11y.comingSoon')})</span>}
              </span>
            ))}
          </div>
          <Link
            href={ROUTES.demo}
            onClick={() => setOpen(false)}
            className={buttonClass({ variant: 'outline', className: 'mb-2 mt-1 w-full' })}
          >
            {t('cta.bookDemo')}
          </Link>
        </nav>
      </div>
    </div>
  );
}
