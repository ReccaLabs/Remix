import { tenantAccess } from '@remix/types/api';
import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { brandStyle } from '@/lib/brand';
import { fontVariables } from '@/lib/fonts';
import { findTenant } from '@/server/api';
import './globals.css';

/**
 * The one document for both areas and the 404 page. It never 404s itself: unknown hosts reach
 * app/not-found.tsx through tenant/layout.tsx's getTenant(), which only works when the 404 page
 * renders inside a layout that already succeeded.
 */

export const metadata: Metadata = {
  icons: { icon: '/icon.svg' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading the request (via findTenant) also makes every page dynamic, which CSP nonces need.
  const [tenant, locale, messages, t] = await Promise.all([
    findTenant(),
    getLocale(),
    getMessages(),
    getTranslations('common.a11y'),
  ]);

  // TEN-03: brand colours on <html>, re-validated, and only while the institute is live —
  // suspended/cancelled institutes render the neutral ReMix theme (TEN-06).
  const style =
    tenant && tenantAccess(tenant.status).publicSite ? brandStyle(tenant.brandColor) : undefined;

  return (
    <html lang={locale} className={fontVariables} style={style}>
      <body>
        <a
          href="#main"
          className="bg-ink sr-only z-50 rounded-md px-4 py-2 text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          {t('skipToContent')}
        </a>
        {/* Client islands only get the namespaces they use (error boundaries need `errors`). */}
        <NextIntlClientProvider messages={{ errors: messages.errors }}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
