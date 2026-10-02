import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';
import type { Namespace } from '@/i18n/messages';

/**
 * Gives the client islands below it the message namespaces they use — and only those, so a
 * page doesn't ship every string in the app. `errors` is always included for error boundaries.
 */
export async function IntlIsland({
  namespaces,
  children,
}: {
  namespaces: readonly Namespace[];
  children: ReactNode;
}) {
  const messages = await getMessages();
  const picked = Object.fromEntries(
    Array.from(new Set<Namespace>(['errors', ...namespaces]), (ns) => [ns, messages[ns]]),
  );
  return <NextIntlClientProvider messages={picked}>{children}</NextIntlClientProvider>;
}
