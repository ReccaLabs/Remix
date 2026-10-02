import type { ClassSchedule, ClassSummary } from '@remix/types/api';
import { TIME_ZONE } from '@/i18n/config';

/**
 * Class times (DESIGN.md §5 "Dates"). A slot is an ISO weekday (1 = Monday … 7 = Sunday) plus
 * an Asia/Colombo wall-clock `HH:mm`; it is shown in Asia/Colombo whatever the viewer's device
 * time zone is.
 */

// Sri Lanka has no daylight saving time: Colombo is always UTC+05:30.
const COLOMBO_OFFSET_MINUTES = 5 * 60 + 30;
// 2024-01-01 was a Monday, so ISO weekday N falls on 2024-01-0N.
const REFERENCE_MONDAY_UTC = Date.UTC(2024, 0, 1);
const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant a weekly slot occurs in a reference week, for formatting with Intl. */
export function slotInstant(slot: Pick<ClassSchedule, 'weekday' | 'startTime'>): Date {
  const [hours = 0, minutes = 0] = slot.startTime.split(':').map(Number);
  const wallClockUtc =
    REFERENCE_MONDAY_UTC + (slot.weekday - 1) * DAY_MS + (hours * 60 + minutes) * 60_000;
  return new Date(wallClockUtc - COLOMBO_OFFSET_MINUTES * 60_000);
}

/** `{ weekday: 'Sat', time: '8:00 AM' }` in `locale`, Asia/Colombo. */
export function formatSlot(
  slot: Pick<ClassSchedule, 'weekday' | 'startTime'>,
  locale: string,
): { weekday: string; time: string } {
  const at = slotInstant(slot);
  return {
    weekday: new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: TIME_ZONE }).format(at),
    time: new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: TIME_ZONE,
    }).format(at),
  };
}

/** ISO weekday (1–7), hour and minute of `now` in Asia/Colombo. */
export function colomboClock(now: Date): { weekday: number; hour: number; minute: number } {
  const local = new Date(now.getTime() + COLOMBO_OFFSET_MINUTES * 60_000);
  const day = local.getUTCDay(); // 0 = Sunday
  return { weekday: day === 0 ? 7 : day, hour: local.getUTCHours(), minute: local.getUTCMinutes() };
}

/** Morning before 12:00, afternoon before 17:00, evening after — in Asia/Colombo. */
export function greetingPeriod(now: Date): 'morning' | 'afternoon' | 'evening' {
  const { hour } = colomboClock(now);
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export interface TodaySlot {
  classId: string;
  className: string;
  place: ClassSummary['place'];
  slot: ClassSchedule;
}

/** Every slot of `classes` that falls on today's Colombo weekday, earliest first. */
export function slotsToday(classes: readonly ClassSummary[], now: Date): TodaySlot[] {
  const { weekday } = colomboClock(now);
  return classes
    .flatMap((c) =>
      c.schedule
        .filter((slot) => slot.weekday === weekday)
        .map((slot) => ({ classId: c.id, className: c.name, place: c.place, slot })),
    )
    .sort((a, b) => a.slot.startTime.localeCompare(b.slot.startTime));
}

/** A class's slots in week order (Monday first), then by time. */
export function sortedSchedule(schedule: readonly ClassSchedule[]): ClassSchedule[] {
  return [...schedule].sort(
    (a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime),
  );
}
