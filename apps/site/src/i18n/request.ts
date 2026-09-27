import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { NAMESPACES, type Messages } from './messages';
import { routing } from './routing';

/**
 * Messages are split into one JSON file per page/area (messages/<locale>/<namespace>.json)
 * so several people can edit copy without conflicts. They are merged here into
 * `{ common: {...}, home: {...}, ... }`.
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

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: 'Asia/Colombo',
  };
});
