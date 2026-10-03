import { ApiError } from '@remix/types/api';
import { describe, expect, it } from 'vitest';
import {
  actionError,
  currentMonth,
  fieldErrors,
  formatPhone,
  hasFilters,
  monthOptions,
  needsTwoStep,
  parseListQuery,
  studentsHref,
} from './people';

const problem = (code: ConstructorParameters<typeof ApiError>[0]['code'], extra = {}) =>
  new ApiError({ type: 'about:blank', title: code, status: 400, code, ...extra });

describe('parseListQuery', () => {
  it('uses defaults for an empty URL', () => {
    expect(parseListQuery({})).toMatchObject({ page: 1, pageSize: 25, sort: 'name' });
  });

  it('reads filters, taking the first value of repeated params', () => {
    const q = parseListQuery({ q: ['nimali', 'x'], status: 'invited', minDevices: '2', page: '3' });
    expect(q).toMatchObject({ q: 'nimali', status: 'invited', minDevices: 2, page: 3 });
  });

  it('drops invalid values and unknown keys instead of failing', () => {
    const q = parseListQuery({ status: 'bogus', pageSize: '7', q: 'ok', nope: '1' });
    expect(q.q).toBe('ok');
    expect(q.status).toBeUndefined();
    expect(q.pageSize).toBe(25);
  });
});

describe('studentsHref', () => {
  it('omits defaults and empty values', () => {
    expect(studentsHref('/admin/students', parseListQuery({}))).toBe('/admin/students');
    expect(studentsHref('/admin/students', parseListQuery({ q: 'a b', page: '2' }))).toBe(
      '/admin/students?q=a+b&page=2',
    );
  });

  it('round-trips through parseListQuery', () => {
    const q = parseListQuery({ status: 'archived', sort: 'joined', pageSize: '50', page: '2' });
    const href = studentsHref('/x', q);
    const search = Object.fromEntries(new URL(href, 'http://h').searchParams);
    expect(parseListQuery(search)).toEqual(q);
  });
});

describe('hasFilters', () => {
  it('ignores paging and sorting', () => {
    expect(hasFilters(parseListQuery({ page: '2', sort: 'joined' }))).toBe(false);
    expect(hasFilters(parseListQuery({ minDevices: '1' }))).toBe(true);
  });
});

describe('formatPhone', () => {
  it('writes Sri Lankan mobiles the local way, leaves others alone', () => {
    expect(formatPhone('+94771234567')).toBe('077 123 4567');
    expect(formatPhone('+441234')).toBe('+441234');
  });
});

describe('months', () => {
  it('currentMonth is the first of the month in Colombo (UTC evening is already tomorrow)', () => {
    expect(currentMonth(new Date('2026-10-31T19:00:00Z'))).toBe('2026-11-01');
    expect(currentMonth(new Date('2026-10-15T04:30:00Z'))).toBe('2026-10-01');
  });

  it('monthOptions steps over year ends', () => {
    expect(monthOptions('2026-11-01', 3)).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
  });
});

describe('actionError / fieldErrors', () => {
  it('maps API codes to message keys, anything else to network', () => {
    expect(actionError(problem('PLAN_LIMIT'))).toBe('planLimit');
    expect(actionError(problem('CONFLICT'))).toBe('conflict');
    expect(actionError(problem('FORBIDDEN'))).toBe('forbidden');
    expect(actionError(problem('INTERNAL'))).toBe('unexpected');
    expect(actionError(new TypeError('fetch failed'))).toBe('network');
  });

  it('collects the first message per field', () => {
    const err = problem('VALIDATION_FAILED', {
      errors: [
        { path: 'phone', message: 'a' },
        { path: 'phone', message: 'b' },
      ],
    });
    expect(fieldErrors(err)).toEqual({ phone: 'a' });
    expect(fieldErrors(new Error('x'))).toEqual({});
  });
});

describe('needsTwoStep', () => {
  it('is true for owner, admin and cashier only', () => {
    expect(needsTwoStep(['cashier'])).toBe(true);
    expect(needsTwoStep(['teacher', 'owner'])).toBe(true);
    expect(needsTwoStep(['teacher', 'gatekeeper'])).toBe(false);
  });
});
