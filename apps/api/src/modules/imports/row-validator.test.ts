import { describe, expect, it } from 'vitest';
import type { ImportRow } from '@remix/types';
import {
  classKey,
  classNamesOf,
  normalisePhone,
  phonesOf,
  validateStudentRows,
  type ValidationContext,
} from './row-validator';

const PHYSICS = '11111111-1111-4111-8111-111111111111';
const CHEMISTRY = '22222222-2222-4222-8222-222222222222';

const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  phones: new Map([['+94771111111', 'TT-0001']]),
  studentNos: new Set(['TT-0001']),
  classes: new Map([
    [classKey('Physics Theory'), { ids: [PHYSICS], archived: false }],
    [classKey('Chemistry'), { ids: [CHEMISTRY], archived: false }],
    [classKey('Old Class'), { ids: ['33333333-3333-4333-8333-333333333333'], archived: true }],
    [classKey('Twin'), { ids: [PHYSICS, CHEMISTRY], archived: false }],
  ]),
  ...over,
});

const row = (over: ImportRow = {}): ImportRow => ({
  displayName: 'Nimali Perera',
  phone: '077 234 5678',
  ...over,
});

const one = (over: ImportRow, context = ctx()) => {
  const out = validateStudentRows([row(over)], context);
  const [result] = out.results;
  if (!result) throw new Error('no result');
  return { result, valid: out.valid[0], out };
};

describe('validateStudentRows — valid rows', () => {
  it('accepts the minimum (name + phone) and normalises the phone', () => {
    const { result, valid } = one({});
    expect(result).toEqual({ rowNo: 1, status: 'ok', errors: [], duplicateOf: null });
    expect(valid).toMatchObject({
      displayName: 'Nimali Perera',
      phone: '+94772345678',
      studentNo: null,
      under18: false,
      guardian: null,
      classIds: [],
    });
  });

  it('accepts a full row', () => {
    const { result, valid } = one({
      studentNo: 'OLD-77',
      school: 'Ananda College',
      alYear: '2027',
      medium: 'Sinhala',
      under18: 'Yes',
      consentGivenBy: 'Sunethra Perera',
      guardianName: 'Sunethra Perera',
      guardianRelation: 'Mother',
      guardianPhone: '0712345678',
      classes: 'physics theory ; CHEMISTRY;;physics THEORY',
    });
    expect(result.status).toBe('ok');
    expect(valid).toMatchObject({
      studentNo: 'OLD-77',
      school: 'Ananda College',
      alYear: 2027,
      medium: 'sinhala',
      under18: true,
      consentGivenBy: 'Sunethra Perera',
      guardian: { name: 'Sunethra Perera', relation: 'mother', phone: '+94712345678' },
      classIds: [PHYSICS, CHEMISTRY],
    });
  });

  it('defaults a guardian without a relation to "guardian"', () => {
    const { valid } = one({ guardianName: 'Kamal', guardianPhone: '0712345678' });
    expect(valid?.guardian?.relation).toBe('guardian');
  });
});

describe('validateStudentRows — errors', () => {
  const fields = (over: ImportRow) => one(over).result.errors.map((e) => e.field);

  it('requires name and phone', () => {
    expect(fields({ displayName: '  ', phone: '' })).toEqual(['displayName', 'phone']);
  });

  it('rejects landlines and garbage phones', () => {
    expect(fields({ phone: '011 2 345 678' })).toEqual(['phone']);
    expect(fields({ phone: 'call me' })).toEqual(['phone']);
  });

  it('requires consent for under-18 students', () => {
    expect(fields({ under18: 'true' })).toEqual(['consentGivenBy']);
    expect(fields({ under18: 'maybe' })).toEqual(['under18']);
  });

  it('checks A/L year, medium, school length and student number format', () => {
    expect(fields({ alYear: '27' })).toEqual(['alYear']);
    expect(fields({ alYear: '1999' })).toEqual(['alYear']);
    expect(fields({ medium: 'french' })).toEqual(['medium']);
    expect(fields({ school: 'x'.repeat(121) })).toEqual(['school']);
    expect(fields({ studentNo: 'has$symbol' })).toEqual(['studentNo']);
  });

  it('refuses a student number that is already used, in the database or earlier in the file', () => {
    expect(fields({ studentNo: 'TT-0001' })).toEqual(['studentNo']);
    const out = validateStudentRows(
      [row({ studentNo: 'N-1' }), row({ phone: '0773456789', studentNo: 'N-1' })],
      ctx(),
    );
    expect(out.results[0]?.status).toBe('ok');
    expect(out.results[1]).toMatchObject({
      status: 'error',
      errors: [{ field: 'studentNo', message: expect.stringContaining('row 1') as string }],
    });
  });

  it('preserves display spelling and rejects case/whitespace collisions per row', () => {
    const out = validateStudentRows(
      [
        row({ studentNo: ' old - 77 ' }),
        row({ phone: '0773456789', studentNo: 'OLD-77' }),
        row({ phone: '0774567890', studentNo: ' tt - 0001' }),
      ],
      ctx(),
    );
    expect(out.valid[0]?.studentNo).toBe(' old - 77 ');
    expect(out.results.map((r) => r.status)).toEqual(['ok', 'error', 'error']);
    expect(out.results[1]?.errors[0]?.message).toContain('row 1');
    expect(out.results[2]?.errors[0]?.message).toContain('ignoring case and whitespace');
  });
  it('rejects nonportable whitespace and non-English letters rather than assigning a different identity', () => {
    for (const studentNo of [
      'old\u00a0-77',
      'old\ufeff-77',
      'old\u2007-77',
      'old\u202f-77',
      'straße',
    ]) {
      expect(one({ studentNo }).result).toMatchObject({
        status: 'error',
        errors: [{ field: 'studentNo', message: expect.any(String) as string }],
      });
    }
  });

  it('needs guardian name and phone together and a known relation', () => {
    expect(fields({ guardianName: 'Kamal' })).toEqual(['guardianPhone']);
    expect(fields({ guardianPhone: '0712345678' })).toEqual(['guardianName']);
    expect(
      fields({ guardianName: 'K', guardianPhone: '0712345678', guardianRelation: 'uncle' }),
    ).toEqual(['guardianRelation']);
  });

  it('reports unknown, archived and ambiguous classes by name', () => {
    const { result } = one({ classes: 'Physics Theory; Biology; Old Class; Twin' });
    expect(result.status).toBe('error');
    expect(result.errors.map((e) => e.field)).toEqual(['classes', 'classes', 'classes']);
    expect(result.errors.map((e) => e.message)).toEqual([
      'No class named "Biology"',
      '"Old Class" is archived',
      'More than one class is named "Twin"',
    ]);
  });

  it('refuses control characters (NUL would break the insert) in any field', () => {
    const { result, out } = one({ school: 'Ananda\u0000 College', displayName: 'Bad\nName' });
    expect(result.status).toBe('error');
    expect(result.errors.map((e) => e.field)).toEqual(['displayName', 'school']);
    expect(out.valid).toEqual([]);
  });
});

describe('validateStudentRows — duplicates', () => {
  it('flags a phone that already belongs to the tenant, with that student number', () => {
    const { result } = one({ phone: '077-111-1111' });
    expect(result).toMatchObject({
      status: 'duplicate',
      duplicateOf: { studentNo: 'TT-0001', rowNo: null },
    });
  });

  it('flags a phone repeated within the file against the first row', () => {
    const out = validateStudentRows(
      [row(), row({ displayName: 'Other' }), row({ phone: '+94772345678' })],
      ctx(),
    );
    expect(out.results.map((r) => r.status)).toEqual(['ok', 'duplicate', 'duplicate']);
    expect(out.results[1]?.duplicateOf).toEqual({ studentNo: null, rowNo: 1 });
    expect(out.results[2]?.duplicateOf).toEqual({ studentNo: null, rowNo: 1 });
    expect(out.summary).toEqual({ total: 3, ok: 1, errors: 0, duplicates: 2 });
    expect(out.valid.map((v) => v.rowNo)).toEqual([1]);
  });

  it('numbers rows from 1 and keeps the summary consistent', () => {
    const out = validateStudentRows(
      [row(), row({ phone: 'x' }), row({ phone: '0773456789' }), row({ phone: '0771111111' })],
      ctx(),
    );
    expect(out.results.map((r) => [r.rowNo, r.status])).toEqual([
      [1, 'ok'],
      [2, 'error'],
      [3, 'ok'],
      [4, 'duplicate'],
    ]);
    expect(out.summary).toEqual({ total: 4, ok: 2, errors: 1, duplicates: 1 });
  });
});

describe('formula injection (T12)', () => {
  const payloads = [
    '=HYPERLINK("http://evil.example","click")',
    "+1+cmd|' /C calc'!A0",
    '-2+3',
    '@SUM(1+1)',
    "=cmd|' /C calc'!A0",
  ];

  it('treats formula-looking text as plain data: stored verbatim, never evaluated or stripped', () => {
    for (const payload of payloads) {
      const { result, valid } = one({ displayName: payload, school: payload });
      expect(result.status).toBe('ok');
      expect(valid?.displayName).toBe(payload);
      expect(valid?.school).toBe(payload);
    }
  });

  it('does not let a formula pass as a phone, medium or class', () => {
    const { result } = one({
      phone: '=1+1',
      medium: '=HYPERLINK("x")',
      classes: '=HYPERLINK("x")',
    });
    expect(result.errors.map((e) => e.field)).toEqual(['phone', 'medium', 'classes']);
  });
});

describe('helpers', () => {
  it('normalisePhone / phonesOf', () => {
    expect(normalisePhone('0771234567')).toBe('+94771234567');
    expect(normalisePhone('nope')).toBeNull();
    expect(phonesOf([row(), row(), row({ phone: 'x' })])).toEqual(['+94772345678']);
  });

  it('classNamesOf returns each distinct class key once', () => {
    expect(classNamesOf([row({ classes: 'A; b' }), row({ classes: 'B ;c;;' })])).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
