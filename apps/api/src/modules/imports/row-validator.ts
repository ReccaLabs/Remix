import {
  GUARDIAN_RELATIONS,
  MEDIUMS,
  sriLankaMobile,
  type GuardianRelation,
  type ImportField,
  type ImportRow,
  type ImportRowResult,
  type Medium,
} from '@remix/types';

/**
 * STU-04 — the one place that decides whether an imported row is a valid student. Preview and the
 * worker both call {@link validateStudentRows}, so a row that previews as `ok` cannot fail the
 * commit for a rule reason. The rules mirror "Add student" (`createStudentSchema`):
 *
 * - every cell is plain text. Nothing is evaluated: a cell such as `=HYPERLINK(…)` is just a
 *   string (it is rendered as text and prefixed with `'` in the downloadable error file);
 * - control characters (NUL would also make Postgres reject the row) are refused in any field;
 * - phone: `sriLankaMobile`, normalised to +947XXXXXXXX; the number identifies the student, so a
 *   phone that already belongs to anyone in the tenant, or to an earlier row of the file, makes
 *   the row a `duplicate` (reported, not imported);
 * - under 18 requires `consentGivenBy`;
 * - `classes`: `;`-separated names, matched case-insensitively against non-archived classes.
 */

export interface ValidStudent {
  rowNo: number;
  displayName: string;
  phone: string;
  /** Kept as given (it is free); null = the server allocates one. */
  studentNo: string | null;
  school: string | null;
  alYear: number | null;
  medium: Medium | null;
  under18: boolean;
  consentGivenBy: string | null;
  guardian: { name: string; relation: GuardianRelation; phone: string } | null;
  classIds: string[];
}

export interface ClassMatch {
  ids: string[];
  archived: boolean;
}

/** What the database already holds; loaded by the service for the rows being validated. */
export interface ValidationContext {
  /** Existing phone (any user of the tenant) → that student's number, or null for non-students. */
  phones: ReadonlyMap<string, string | null>;
  /** Student numbers already in use. */
  studentNos: ReadonlySet<string>;
  /** Class name (see {@link classKey}) → matching classes. */
  classes: ReadonlyMap<string, ClassMatch>;
}

export interface ValidationOutcome {
  results: ImportRowResult[];
  /** The `ok` rows, in file order. */
  valid: ValidStudent[];
  summary: { total: number; ok: number; errors: number; duplicates: number };
}

const CONTROL = /\p{Cc}/u;
const STUDENT_NO = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/;
const TRUE_WORDS = new Set(['true', 'yes', 'y', '1']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0']);
const MAX_CLASSES = 20;

/** Case-insensitive, whitespace-insensitive class name key. */
export const classKey = (name: string): string =>
  name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

/** The normalised phone of a cell, or null when it is not a Sri Lankan mobile. */
export function normalisePhone(raw: string | undefined): string | null {
  const parsed = sriLankaMobile.safeParse(raw ?? '');
  return parsed.success ? parsed.data : null;
}

const clean = (value: string | undefined): string => (value ?? '').trim();

/** Phones present in the rows (for loading the duplicate context). */
export function phonesOf(rows: readonly ImportRow[]): string[] {
  const phones = new Set<string>();
  for (const row of rows) {
    const phone = normalisePhone(row.phone);
    if (phone) phones.add(phone);
  }
  return [...phones];
}

export function studentNosOf(rows: readonly ImportRow[]): string[] {
  const numbers = new Set<string>();
  for (const row of rows) {
    const value = clean(row.studentNo);
    if (STUDENT_NO.test(value)) numbers.add(value);
  }
  return [...numbers];
}

export function classNamesOf(rows: readonly ImportRow[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) for (const name of splitClasses(row.classes)) keys.add(classKey(name));
  return [...keys];
}

const splitClasses = (cell: string | undefined): string[] =>
  clean(cell)
    .split(';')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

class RowErrors {
  readonly list: { field: string; message: string }[] = [];
  add(field: ImportField, message: string): void {
    this.list.push({ field, message });
  }
}

/** Validate every row. Pure: no I/O, the context carries what the database knows. */
export function validateStudentRows(
  rows: readonly ImportRow[],
  ctx: ValidationContext,
): ValidationOutcome {
  const results: ImportRowResult[] = [];
  const valid: ValidStudent[] = [];
  const phoneRows = new Map<string, number>();
  const numberRows = new Map<string, number>();

  rows.forEach((row, index) => {
    const rowNo = index + 1;
    const errors = new RowErrors();

    for (const [field, value] of Object.entries(row)) {
      if (typeof value === 'string' && CONTROL.test(value)) {
        errors.add(field as ImportField, 'Contains characters that are not allowed');
      }
    }
    const hasControl = errors.list.length > 0;

    // name
    const displayName = clean(row.displayName);
    if (!displayName) errors.add('displayName', 'Name is required');
    else if (displayName.length > 120)
      errors.add('displayName', 'Name is longer than 120 characters');

    // phone + duplicates
    let phone: string | null = null;
    let duplicateOf: ImportRowResult['duplicateOf'] = null;
    if (!clean(row.phone)) errors.add('phone', 'Phone is required');
    else {
      phone = normalisePhone(row.phone);
      if (!phone) errors.add('phone', 'Enter a Sri Lankan mobile number, e.g. 077 123 4567');
    }
    if (phone) {
      const earlier = phoneRows.get(phone);
      if (earlier !== undefined) duplicateOf = { studentNo: null, rowNo: earlier };
      else {
        phoneRows.set(phone, rowNo);
        if (ctx.phones.has(phone))
          duplicateOf = { studentNo: ctx.phones.get(phone) ?? null, rowNo: null };
      }
    }

    // student number
    let studentNo: string | null = null;
    const numberCell = clean(row.studentNo);
    if (numberCell) {
      if (!STUDENT_NO.test(numberCell)) {
        errors.add('studentNo', 'Use letters, digits and dashes only (up to 32 characters)');
      } else if (ctx.studentNos.has(numberCell)) {
        errors.add('studentNo', 'This student number is already used');
      } else if (numberRows.has(numberCell)) {
        errors.add(
          'studentNo',
          `This student number is also used in row ${numberRows.get(numberCell)}`,
        );
      } else {
        studentNo = numberCell;
        numberRows.set(numberCell, rowNo);
      }
    }

    // school, A/L year, medium
    const school = clean(row.school);
    if (school.length > 120) errors.add('school', 'School is longer than 120 characters');

    let alYear: number | null = null;
    const yearCell = clean(row.alYear);
    if (yearCell) {
      const year = /^\d{4}$/.test(yearCell) ? Number(yearCell) : NaN;
      if (year >= 2000 && year <= 2100) alYear = year;
      else errors.add('alYear', 'Enter a four-digit year between 2000 and 2100');
    }

    let medium: Medium | null = null;
    const mediumCell = clean(row.medium).toLowerCase();
    if (mediumCell) {
      const match = MEDIUMS.find((m) => m === mediumCell);
      if (match) medium = match;
      else errors.add('medium', `Use one of: ${MEDIUMS.join(', ')}`);
    }

    // under 18 + consent
    let under18 = false;
    const flag = clean(row.under18).toLowerCase();
    if (flag) {
      if (TRUE_WORDS.has(flag)) under18 = true;
      else if (!FALSE_WORDS.has(flag)) errors.add('under18', 'Use yes or no');
    }
    const consentGivenBy = clean(row.consentGivenBy);
    if (consentGivenBy.length > 120) {
      errors.add('consentGivenBy', 'Name is longer than 120 characters');
    } else if (under18 && !consentGivenBy) {
      errors.add('consentGivenBy', 'Parental consent is required for students under 18');
    }

    // guardian
    let guardian: ValidStudent['guardian'] = null;
    const gName = clean(row.guardianName);
    const gRelationCell = clean(row.guardianRelation).toLowerCase();
    const gPhoneCell = clean(row.guardianPhone);
    if (gName || gRelationCell || gPhoneCell) {
      let relation: GuardianRelation = 'guardian';
      if (gRelationCell) {
        const match = GUARDIAN_RELATIONS.find((r) => r === gRelationCell);
        if (match) relation = match;
        else errors.add('guardianRelation', `Use one of: ${GUARDIAN_RELATIONS.join(', ')}`);
      }
      if (!gName) errors.add('guardianName', 'Guardian name is required with a guardian phone');
      else if (gName.length > 120) {
        errors.add('guardianName', 'Name is longer than 120 characters');
      }
      let gPhone: string | null = null;
      if (!gPhoneCell)
        errors.add('guardianPhone', 'Guardian phone is required with a guardian name');
      else {
        gPhone = normalisePhone(gPhoneCell);
        if (!gPhone) {
          errors.add('guardianPhone', 'Enter a Sri Lankan mobile number, e.g. 077 123 4567');
        }
      }
      if (gName && gName.length <= 120 && gPhone)
        guardian = { name: gName, relation, phone: gPhone };
    }

    // classes
    const classIds: string[] = [];
    const names = splitClasses(row.classes);
    if (names.length > MAX_CLASSES) {
      errors.add('classes', `At most ${MAX_CLASSES} classes per student`);
    } else {
      for (const name of names) {
        const match = ctx.classes.get(classKey(name));
        const shown = name.length > 60 ? `${name.slice(0, 57)}...` : name;
        if (!match) errors.add('classes', `No class named "${shown}"`);
        else if (match.archived) errors.add('classes', `"${shown}" is archived`);
        else if (match.ids.length > 1) {
          errors.add('classes', `More than one class is named "${shown}"`);
        } else if (match.ids[0] && !classIds.includes(match.ids[0])) classIds.push(match.ids[0]);
      }
    }

    const status: ImportRowResult['status'] = duplicateOf
      ? 'duplicate'
      : errors.list.length > 0
        ? 'error'
        : 'ok';
    results.push({ rowNo, status, errors: errors.list, duplicateOf });
    if (status === 'ok' && phone && !hasControl) {
      valid.push({
        rowNo,
        displayName,
        phone,
        studentNo,
        school: school || null,
        alYear,
        medium,
        under18,
        consentGivenBy: under18 ? consentGivenBy : null,
        guardian,
        classIds,
      });
    }
  });

  const count = (status: ImportRowResult['status']) =>
    results.filter((r) => r.status === status).length;
  return {
    results,
    valid,
    summary: {
      total: results.length,
      ok: count('ok'),
      errors: count('error'),
      duplicates: count('duplicate'),
    },
  };
}
