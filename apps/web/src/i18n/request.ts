import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, TIME_ZONE } from './config';
import { NAMESPACES, type Messages } from './messages';

/**
 * Messages are split into one JSON file per area (messages/<locale>/<namespace>.json) and
 * merged here into `{ common: {...}, errors: {...}, ... }`.
 */
async function loadMessages(locale: string): Promise<Messages> {
  const entries = await Promise.all(
    NAMESPACES.map(async (ns) => {
      const mod = (await import(`../../messages/${locale}/${ns}.json`)) as { default: unknown };
      return [ns, mod.default] as const;
    }),
  );
  return Object.fromEntries(entries) as unknown as Messages;
}

// No locale in the URL and no next-intl middleware: English until per-user/tenant locales land.
export default getRequestConfig(async () => ({
  locale: DEFAULT_LOCALE,
  messages: await loadMessages(DEFAULT_LOCALE),
  timeZone: TIME_ZONE,
}));
