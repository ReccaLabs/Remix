import { TIME_ZONE } from '@/i18n/config';

/**
 * "Last used" of a device (AUTH-03/04), in Asia/Colombo whatever the viewer's time zone:
 * the time today, the weekday and time within a week, otherwise the date.
 */
export function formatLastUsed(iso: string, locale: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const day = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);
  if (day(at) === day(now)) return time;
  const ageMs = now.getTime() - at.getTime();
  if (ageMs >= 0 && ageMs < 6 * 24 * 60 * 60 * 1000) {
    const weekday = new Intl.DateTimeFormat(locale, { timeZone: TIME_ZONE, weekday: 'short' }).format(
      at,
    );
    return `${weekday} ${time}`;
  }
  return new Intl.DateTimeFormat(locale, {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(at);
}
