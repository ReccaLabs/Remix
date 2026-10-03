import {
  ApiError,
  listStudentsQuerySchema,
  STUDENT_DEVICE_LIMIT,
  type ListStudentsQuery,
  type StaffMember,
  type StudentStatus,
} from '@remix/types/api';
import type { StatusTone } from '@remix/ui';

/**
 * Pure helpers of the people screens (admin students and staff): list query ↔ URL, phone and
 * month formatting, status tones, and mapping API failures to a message key.
 */

export type ListQuery = ReturnType<typeof listStudentsQuerySchema.parse>;

type SearchParams = Record<string, string | string[] | undefined>;

const QUERY_KEYS = [
  'q',
  'classId',
  'status',
  'minDevices',
  'joinedFrom',
  'joinedTo',
  'sort',
  'page',
  'pageSize',
] as const;

/**
 * The students list query from the page's `searchParams`. Unknown keys and invalid values are
 * ignored (a hand-edited URL shows the default list instead of an error page).
 */
export function parseListQuery(params: SearchParams): ListQuery {
  const picked: Record<string, string> = {};
  for (const key of QUERY_KEYS) {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value !== undefined && value !== '') picked[key] = value;
  }
  const strict = listStudentsQuerySchema.safeParse(picked);
  if (strict.success) return strict.data;
  // Drop the keys that failed, keep the rest.
  for (const issue of strict.error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string') delete picked[key];
  }
  const retry = listStudentsQuerySchema.safeParse(picked);
  return retry.success ? retry.data : listStudentsQuerySchema.parse({});
}

/** The students list URL for `query`; defaults are left out so URLs stay short. */
export function studentsHref(base: string, query: Partial<ListQuery>): string {
  const search = new URLSearchParams();
  for (const key of QUERY_KEYS) {
    const value = query[key];
    if (value === undefined || value === '' || value === null) continue;
    if (key === 'page' && value === 1) continue;
    if (key === 'pageSize' && value === 25) continue;
    if (key === 'sort' && value === 'name') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

/** True when any filter (not paging or sorting) narrows the list. */
export function hasFilters(query: Partial<ListQuery>): boolean {
  return Boolean(
    query.q ||
    query.classId ||
    query.status ||
    query.minDevices ||
    query.joinedFrom ||
    query.joinedTo,
  );
}

/** `+94771234567` → `077 123 4567` (how Sri Lankans write mobiles); anything else unchanged. */
export function formatPhone(phone: string): string {
  const match = /^\+947(\d)(\d{3})(\d{4})$/.exec(phone);
  return match ? `07${match[1]} ${match[2]} ${match[3]}` : phone;
}

export const STATUS_TONE: Record<StudentStatus, StatusTone> = {
  active: 'success',
  invited: 'info',
  archived: 'neutral',
};

export const STAFF_STATUS_TONE: Record<StaffMember['status'], StatusTone> = {
  active: 'success',
  invited: 'info',
  disabled: 'neutral',
};

/** Roles that sign in with an SMS code on a new device (AUTH-05). */
export const TWO_STEP_ROLES = ['owner', 'admin', 'cashier'] as const;

export const needsTwoStep = (roles: readonly string[]): boolean =>
  roles.some((role) => (TWO_STEP_ROLES as readonly string[]).includes(role));

export const DEVICE_LIMIT = STUDENT_DEVICE_LIMIT;

/** `YYYY-MM` of the current month in Asia/Colombo, as the first day of the month. */
export function currentMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-01`;
}

/** The next `count` months starting at `from`, as first-of-month strings. */
export function monthOptions(from: string, count: number): string[] {
  const [y = 0, m = 1] = from.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  });
}

/** A month value as a `Date` (for `format.dateTime(…, { month: 'long', year: 'numeric' })`). */
export const monthDate = (month: string): Date => new Date(`${month}T00:00:00+05:30`);

/** What went wrong in an admin write, as a key under `<namespace>.errors`. */
export type ActionError =
  | 'forbidden'
  | 'conflict'
  | 'planLimit'
  | 'validation'
  | 'rateLimited'
  | 'notFound'
  | 'network'
  | 'unexpected';

export function actionError(err: unknown): ActionError {
  if (!(err instanceof ApiError)) return 'network';
  switch (err.problem.code) {
    case 'FORBIDDEN':
    case 'UNAUTHENTICATED':
      return 'forbidden';
    case 'CONFLICT':
      return 'conflict';
    case 'PLAN_LIMIT':
      return 'planLimit';
    case 'VALIDATION_FAILED':
      return 'validation';
    case 'RATE_LIMITED':
      return 'rateLimited';
    case 'NOT_FOUND':
      return 'notFound';
    default:
      return 'unexpected';
  }
}

/** Field-level validation messages from a 400 (path → first message). */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  for (const e of err.problem.errors ?? []) out[e.path] ??= e.message;
  return out;
}

export type { ListStudentsQuery };
