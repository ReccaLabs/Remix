/**
 * Business dates are calendar values in the tenant's zone (ADR 0007). Every tenant is
 * Asia/Colombo in R1 (`tenants.timezone` is constrained to it); the IANA name is used, never a
 * hard-coded `+05:30`.
 */
export const BUSINESS_TIME_ZONE = 'Asia/Colombo';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The calendar date of `instant` in `timeZone`, as `YYYY-MM-DD`. */
export function calendarDate(instant: Date, timeZone = BUSINESS_TIME_ZONE): string {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * The billing month that contains `instant` in `timeZone`, as the first day of that month
 * (`YYYY-MM-01`) — the form `enrollments.from_month`/`to_month` store.
 */
export function monthStart(instant: Date, timeZone = BUSINESS_TIME_ZONE): string {
  return `${calendarDate(instant, timeZone).slice(0, 7)}-01`;
}

/** `date` (`YYYY-MM-DD`) shifted by whole days. Calendar arithmetic, so DST-free and zone-free. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) throw new RangeError(`Bad date: ${date}`);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
