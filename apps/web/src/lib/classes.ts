import {
  classInputSchema,
  listClassesQuerySchema,
  updateClassSchema,
  type AdminClass,
  type ClassInput,
  type ClassPlace,
  type Medium,
  type TimetableSlot,
  type UpdateClassRequest,
} from '@remix/types/api';
import { formatLKR, lkr } from '@remix/types/money';
import type { StatusTone } from '@remix/ui';
import { formatSlot } from './schedule';

/**
 * Pure helpers of the admin Classes screens (CLS-01…06): list query ↔ URL, the create/edit form
 * (strings in, API payload out), fee parsing, and the weekly timetable's date maths. Dates are
 * plain `YYYY-MM-DD` strings in Asia/Colombo, so no time zone ever sneaks into the arithmetic.
 */

// ---- list query -----------------------------------------------------------------------------

export type ClassesQuery = ReturnType<typeof listClassesQuerySchema.parse>;

type SearchParams = Record<string, string | string[] | undefined>;

const QUERY_KEYS = ['q', 'grade', 'place', 'teacherId', 'archived'] as const;

/** The list query from `searchParams`; invalid values are dropped (a hand-edited URL still works). */
export function parseClassesQuery(params: SearchParams): ClassesQuery {
  const picked: Record<string, string> = {};
  for (const key of QUERY_KEYS) {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value !== undefined && value !== '') picked[key] = value;
  }
  const strict = listClassesQuerySchema.safeParse(picked);
  if (strict.success) return strict.data;
  for (const issue of strict.error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string') delete picked[key];
  }
  const retry = listClassesQuerySchema.safeParse(picked);
  return retry.success ? retry.data : listClassesQuerySchema.parse({});
}

export function classesHref(base: string, query: Partial<ClassesQuery>): string {
  const search = new URLSearchParams();
  for (const key of QUERY_KEYS) {
    const value = query[key];
    if (value === undefined || value === '') continue;
    if (key === 'archived' && value === 'false') continue;
    search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

export function hasClassFilters(query: Partial<ClassesQuery>): boolean {
  return Boolean(
    query.q || query.grade || query.place || query.teacherId || query.archived === 'true',
  );
}

/** Distinct grades of a class list, in first-seen order (filter choices). */
export const gradesOf = (classes: readonly Pick<AdminClass, 'grade'>[]): string[] => [
  ...new Set(classes.map((c) => c.grade)),
];

/** Distinct teachers of a class list (filter choices when the staff list is not available). */
export function teachersOf(
  classes: readonly Pick<AdminClass, 'teacherId' | 'teacherName'>[],
): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const c of classes) if (c.teacherId && c.teacherName) seen.set(c.teacherId, c.teacherName);
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

// ---- money ----------------------------------------------------------------------------------

export const MAX_FEE_CENTS = 100_000_000;

/**
 * Rupees typed by a person ("2,500", "1250.50", " 0 ") to integer cents. `null` when it is not
 * an amount: letters, a minus sign, more than two decimals, or an empty string.
 */
export function parseRupees(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, '');
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(cleaned)) return null;
  return lkr(Number(cleaned));
}

/** "LKR 2,500", or "LKR 1,250.50" when there are cents. */
export const formatFee = (cents: number): string => formatLKR(cents, { exact: cents % 100 !== 0 });

/** Cents as the text a fee input starts with: 250000 → "2500", 125050 → "1250.50". */
export function rupeesText(cents: number): string {
  const rupees = cents / 100;
  return Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2);
}

export type FeeProblem = 'feeInvalid' | 'feeTooHigh';

export function feeProblem(text: string): FeeProblem | null {
  const cents = parseRupees(text);
  if (cents === null) return 'feeInvalid';
  return cents > MAX_FEE_CENTS ? 'feeTooHigh' : null;
}

// ---- class form -----------------------------------------------------------------------------

export interface SlotValues {
  weekday: string;
  startTime: string;
  durationMinutes: string;
}

export interface ClassFormValues {
  name: string;
  grade: string;
  medium: Medium;
  /** '' = no teacher. */
  teacherId: string;
  place: ClassPlace;
  /** '' = no hall. */
  hallId: string;
  fee: string;
  /** '' = not set. */
  startsOn: string;
  schedule: SlotValues[];
}

export const MAX_SLOTS = 14;
export const DURATIONS = [30, 45, 60, 90, 120, 150, 180, 240, 300] as const;

export const blankSlot = (): SlotValues => ({
  weekday: '6',
  startTime: '08:00',
  durationMinutes: '120',
});

export function emptyClassValues(): ClassFormValues {
  return {
    name: '',
    grade: '',
    medium: 'sinhala',
    teacherId: '',
    place: 'hall',
    hallId: '',
    fee: '',
    startsOn: '',
    schedule: [],
  };
}

export function valuesFromClass(c: AdminClass): ClassFormValues {
  return {
    name: c.name,
    grade: c.grade,
    medium: c.medium,
    teacherId: c.teacherId ?? '',
    place: c.place,
    hallId: c.hallId ?? '',
    fee: rupeesText(c.feeCents),
    startsOn: c.startsOn ?? '',
    schedule: c.schedule.map((s) => ({
      weekday: String(s.weekday),
      startTime: s.startTime,
      durationMinutes: String(s.durationMinutes),
    })),
  };
}

/** The request body the form stands for (fee 0 when the text is not an amount: see `feeProblem`). */
export function classPayload(values: ClassFormValues): ClassInput {
  return {
    name: values.name.trim(),
    grade: values.grade.trim(),
    medium: values.medium,
    teacherId: values.teacherId || null,
    feeCents: parseRupees(values.fee) ?? 0,
    place: values.place,
    // An online class has no hall, whatever was picked before switching.
    hallId: values.place === 'online' ? null : values.hallId || null,
    startsOn: values.startsOn || null,
    schedule: values.schedule.map((s) => ({
      weekday: Number(s.weekday),
      startTime: s.startTime,
      durationMinutes: Number(s.durationMinutes),
    })),
  };
}

export interface ClassIssue {
  /** A react-hook-form field name: `name`, `fee`, `schedule.1.startTime`… */
  field: string;
  /** A key under `classes.form.errors`. */
  message:
    | 'required'
    | 'invalid'
    | 'feeInvalid'
    | 'feeTooHigh'
    | 'onlineNoHall'
    | 'duplicateTime'
    | 'teacherInvalid'
    | 'hallInvalid';
}

/** Checks the form with the API's own schemas (create or edit) before anything is sent. */
export function validateClass(mode: 'create' | 'edit', values: ClassFormValues): ClassIssue[] {
  const issues: ClassIssue[] = [];
  const problem = feeProblem(values.fee);
  if (problem) issues.push({ field: 'fee', message: problem });

  const payload = classPayload(values);
  const parsed =
    mode === 'create'
      ? classInputSchema.safeParse(payload)
      : updateClassSchema.safeParse(payload as UpdateClassRequest);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [head, index, leaf] = issue.path;
      if (head === 'feeCents') continue; // reported as the fee field above
      if (head === 'name' || head === 'grade') {
        issues.push({ field: head, message: 'required' });
      } else if (head === 'hallId') {
        issues.push({ field: 'hallId', message: 'onlineNoHall' });
      } else if (head === 'schedule' && typeof index === 'number' && typeof leaf === 'string') {
        issues.push({ field: `schedule.${index}.${leaf}`, message: 'invalid' });
      } else if (typeof head === 'string') {
        issues.push({ field: head, message: 'invalid' });
      }
    }
  }

  const seen = new Set<string>();
  for (const [i, slot] of values.schedule.entries()) {
    const key = `${slot.weekday}@${slot.startTime}`;
    if (seen.has(key)) issues.push({ field: `schedule.${i}.startTime`, message: 'duplicateTime' });
    seen.add(key);
  }
  return issues;
}

/** Server field errors (400 problem `errors[].path`) mapped to form fields. */
export function serverClassField(path: string): { field: string; message: ClassIssue['message'] } {
  if (path === 'feeCents') return { field: 'fee', message: 'feeInvalid' };
  if (path === 'teacherId') return { field: 'teacherId', message: 'teacherInvalid' };
  if (path === 'hallId') return { field: 'hallId', message: 'hallInvalid' };
  if (/^schedule\.\d+\.startTime$/.test(path)) return { field: path, message: 'duplicateTime' };
  return { field: path, message: 'invalid' };
}

// ---- display --------------------------------------------------------------------------------

export const PLACE_TONE: Record<ClassPlace, StatusTone> = {
  hall: 'neutral',
  online: 'info',
  hybrid: 'info',
};

/** `08:00` + 120 minutes → `10:00`. Wraps past midnight (a class never does, but a typo might). */
export function endTime(start: string, minutes: number): string {
  const [h = 0, m = 0] = start.split(':').map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** `08:00` → "8:00 AM" in `locale`, Asia/Colombo. */
export const formatTime = (hhmm: string, locale: string): string =>
  formatSlot({ weekday: 1, startTime: hhmm }, locale).time;

// ---- timetable dates ------------------------------------------------------------------------

/** Today's calendar date in Asia/Colombo, `YYYY-MM-DD`. */
export function colomboDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a calendar date. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export const mondayOf = (date: string): string => addDays(date, 1 - isoWeekday(date));

/** The seven dates of a week, Monday first. */
export const weekDates = (weekStart: string): string[] =>
  Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

/**
 * The `?week=` of the timetable page: any valid date selects its week (so a shared link to a
 * Wednesday still opens the right Monday); anything else means this week.
 */
export function parseWeek(value: string | string[] | undefined, today: string): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T00:00:00Z`);
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw) {
      return mondayOf(raw);
    }
  }
  return mondayOf(today);
}

/** A calendar date as an instant, for `format.dateTime(…)` with the Asia/Colombo zone. */
export const dateAt = (date: string): Date => new Date(`${date}T00:00:00+05:30`);

export function slotsByDate(slots: readonly TimetableSlot[]): Map<string, TimetableSlot[]> {
  const byDate = new Map<string, TimetableSlot[]>();
  for (const slot of slots) byDate.set(slot.date, [...(byDate.get(slot.date) ?? []), slot]);
  return byDate;
}
