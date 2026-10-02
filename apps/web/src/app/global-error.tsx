'use client';

import { NextIntlClientProvider } from 'next-intl';
import errors from '../../messages/en/errors.json';
import { ErrorView } from '@/components/error-view';
import { fontVariables } from '@/lib/fonts';
import { DEFAULT_LOCALE, TIME_ZONE } from '@/i18n/config';

// Last-resort boundary: errors in an area's root layout (e.g. the API is down while resolving
// the tenant). It replaces every layout, so it brings its own <html> and messages.
export default function GlobalError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang={DEFAULT_LOCALE} className={fontVariables}>
      <body>
        <NextIntlClientProvider locale={DEFAULT_LOCALE} timeZone={TIME_ZONE} messages={{ errors }}>
          <ErrorView {...props} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
