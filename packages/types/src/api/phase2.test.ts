import { describe, expect, it, vi } from 'vitest';
import { contrastRatio, hasReadableContrast, updateThemeSchema } from './admin';
import { otpCodeSchema, TWO_STEP_ROLES } from './auth';
import { classInputSchema, enrolStudentsSchema } from './classes';
import { buildUrl, createApiClient } from './client';
import { pageQuerySchema } from './common';
import { importRowSchema, IMPORT_MAX_ROWS, studentImportSchema } from './imports';
import { API } from './routes';
import { inviteStaffSchema } from './staff';
import { bulkStudentActionSchema, createStudentSchema, listStudentsQuerySchema } from './students';

const ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const ID2 = '0199a1b2-c3d4-7e5f-8a9b-1c1d2e3f4a5b';

describe('buildUrl', () => {
  it('fills and encodes path params', () => {
    expect(buildUrl(API.getStudent, { params: { id: ID } })).toBe(`/api/v1/admin/students/${ID}`);
    expect(buildUrl(API.signOutStudentDevice, { params: { id: ID, deviceId: ID2 } })).toBe(
      `/api/v1/admin/students/${ID}/devices/${ID2}`,
    );
  });

  it('rejects params that fail the schema (no path injection)', () => {
    expect(() => buildUrl(API.getStudent, { params: { id: '../staff' } })).toThrow();
    expect(() => buildUrl(API.getStudent, undefined)).toThrow();
  });

  it('serialises the validated query and drops empty values', () => {
    const url = buildUrl(API.listStudents, { query: { q: 'nimali', page: 2 } });
    expect(url).toBe('/api/v1/admin/students?page=2&pageSize=25&q=nimali&sort=name');
  });

  it('rejects unknown query keys', () => {
    expect(() =>
      buildUrl(API.listStudents, { query: { evil: '1' } as unknown as { q: string } }),
    ).toThrow();
  });
});

describe('createApiClient with params', () => {
  it('passes the body first and params second', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
    const api = createApiClient({ fetch });
    await api.call('signOutMyDevice', { params: { id: ID } });
    expect(fetch.mock.calls[0]![0]).toBe(`/api/v1/me/devices/${ID}`);
    expect(fetch.mock.calls[0]![1]?.method).toBe('DELETE');
  });
});

describe('query coercion', () => {
  it('coerces numeric strings and rejects odd page sizes', () => {
    expect(pageQuerySchema.parse({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 });
    expect(pageQuerySchema.safeParse({ pageSize: '7' }).success).toBe(false);
    expect(listStudentsQuerySchema.parse({ minDevices: '2' }).minDevices).toBe(2);
  });
});

describe('auth rules', () => {
  it('accepts a pasted code with spaces', () => {
    expect(otpCodeSchema.parse(' 123 456 ')).toBe('123456');
    expect(otpCodeSchema.safeParse('12345').success).toBe(false);
    expect(otpCodeSchema.safeParse('abcdef').success).toBe(false);
  });

  it('requires 2-step for owner, admin and cashier only', () => {
    expect([...TWO_STEP_ROLES].sort()).toEqual(['admin', 'cashier', 'owner']);
  });
});

describe('students', () => {
  const base = { displayName: 'Nimali Perera', phone: '0771234567' };

  it('requires consent for students under 18 (PAR-03)', () => {
    expect(createStudentSchema.safeParse({ ...base, under18: true }).success).toBe(false);
    expect(
      createStudentSchema.safeParse({
        ...base,
        under18: true,
        consent: { givenBy: 'K. Perera', method: 'paper_form' },
      }).success,
    ).toBe(true);
  });

  it('normalises phones and defaults lists', () => {
    const s = createStudentSchema.parse(base);
    expect(s.phone).toBe('+94771234567');
    expect(s.guardians).toEqual([]);
    expect(s.classIds).toEqual([]);
  });

  it('caps bulk actions at 500 students', () => {
    const ids = Array.from({ length: 501 }, () => ID);
    expect(bulkStudentActionSchema.safeParse({ action: 'archive', studentIds: ids }).success).toBe(
      false,
    );
  });
});

describe('classes', () => {
  const cls = {
    name: 'Physics 2027',
    grade: '2027 A/L',
    medium: 'sinhala',
    feeCents: 250000,
    place: 'hall',
  } as const;

  it('keeps fees as integer cents', () => {
    expect(classInputSchema.safeParse({ ...cls, feeCents: 2500.5 }).success).toBe(false);
  });

  it('does not give online classes a hall', () => {
    expect(classInputSchema.safeParse({ ...cls, place: 'online', hallId: ID }).success).toBe(false);
  });

  it('needs a reason for a fee override', () => {
    const e = { studentIds: [ID], fromMonth: '2026-10-01', feeOverrideCents: 0 };
    expect(enrolStudentsSchema.safeParse(e).success).toBe(false);
    expect(enrolStudentsSchema.safeParse({ ...e, reason: 'Free card' }).success).toBe(true);
    expect(
      enrolStudentsSchema.safeParse({ ...e, fromMonth: '2026-10-02', reason: 'x' }).success,
    ).toBe(false);
  });
});

describe('staff', () => {
  it('requires a phone for roles with SMS 2-step', () => {
    expect(
      inviteStaffSchema.safeParse({ displayName: 'Sunil', email: 's@example.lk', role: 'cashier' })
        .success,
    ).toBe(false);
    expect(
      inviteStaffSchema.safeParse({ displayName: 'Sunil', email: 's@example.lk', role: 'teacher' })
        .success,
    ).toBe(true);
  });
});

describe('import', () => {
  it('rejects unknown columns and oversized files', () => {
    expect(importRowSchema.safeParse({ displayName: 'A', password: 'x' }).success).toBe(false);
    const rows = Array.from({ length: IMPORT_MAX_ROWS + 1 }, () => ({ displayName: 'A' }));
    expect(studentImportSchema.safeParse({ rows }).success).toBe(false);
  });
});

describe('theme contrast (TEN-03)', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('rejects brand colours too light for white text', () => {
    expect(hasReadableContrast('#1d4ed8')).toBe(true);
    expect(hasReadableContrast('#facc15')).toBe(false);
    expect(updateThemeSchema.safeParse({ brandColor: '#facc15' }).success).toBe(false);
    expect(updateThemeSchema.safeParse({ brandColor: null }).success).toBe(true);
  });

  it('only accepts https image URLs', () => {
    expect(updateThemeSchema.safeParse({ logoUrl: 'http://x.lk/logo.png' }).success).toBe(false);
    expect(updateThemeSchema.safeParse({ logoUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(updateThemeSchema.safeParse({ logoUrl: 'https://x.lk/logo.png' }).success).toBe(true);
  });
});

describe('listTeachers (CLS-02)', () => {
  it('defines the picker route and a strict minimal response', () => {
    expect(API.listTeachers.method).toBe('GET');
    expect(buildUrl(API.listTeachers, undefined)).toBe('/api/v1/admin/teachers');
    expect(
      API.listTeachers.response.parse({ items: [{ id: ID, displayName: 'Teacher' }] }),
    ).toEqual({ items: [{ id: ID, displayName: 'Teacher' }] });
    expect(
      API.listTeachers.response.safeParse({
        items: [{ id: ID, displayName: 'Teacher', phone: '+94771234567' }],
      }).success,
    ).toBe(false);
    expect(API.listTeachers.response.safeParse({ items: [], total: 0 }).success).toBe(false);
  });
});
