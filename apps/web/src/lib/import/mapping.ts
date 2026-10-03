import {
  IMPORT_FIELDS,
  REQUIRED_IMPORT_FIELDS,
  type ImportField,
  type ImportRow,
} from '@remix/types/api';

/**
 * STU-04 — column mapping of the import wizard: which column of the file feeds which student
 * field. Headers are matched by a forgiving name (case, spaces and punctuation ignored); the
 * user can always change the guess.
 */

/** Column index of the file for each field; `null` = not in the file. */
export type Mapping = Record<ImportField, number | null>;

/** Per-cell cap, same as the API contract (`importRowSchema`). */
export const MAX_CELL_LENGTH = 500;

/** Header spellings (lower case, letters and digits only) that mean each field. */
const SYNONYMS: Record<ImportField, readonly string[]> = {
  displayName: ['name', 'fullname', 'studentname', 'displayname', 'student', 'nameofstudent'],
  phone: [
    'phone',
    'phonenumber',
    'mobile',
    'mobilenumber',
    'mobileno',
    'contact',
    'contactnumber',
    'contactno',
    'telephone',
    'tel',
    'whatsapp',
    'studentphone',
    'studentmobile',
  ],
  studentNo: [
    'studentno',
    'studentnumber',
    'studentid',
    'admissionno',
    'admissionnumber',
    'regno',
    'registrationno',
    'registrationnumber',
  ],
  school: ['school', 'schoolname'],
  alYear: ['alyear', 'alexamyear', 'examyear', 'year', 'batch', 'albatch'],
  medium: ['medium', 'mediumofstudy', 'language'],
  under18: ['under18', 'below18', 'minor', 'isminor', 'under18years'],
  consentGivenBy: ['consentgivenby', 'consentby', 'consent', 'parentalconsent', 'consentgiver'],
  guardianName: ['guardianname', 'guardian', 'parentname', 'parent', 'parentguardian'],
  guardianRelation: ['guardianrelation', 'relation', 'relationship', 'parentrelation'],
  guardianPhone: [
    'guardianphone',
    'guardianmobile',
    'guardiancontact',
    'parentphone',
    'parentmobile',
    'parentcontact',
    'parentnumber',
    'guardiannumber',
  ],
  classes: ['classes', 'class', 'classnames', 'subjects', 'courses', 'enrolledclasses'],
};

export const normaliseHeader = (header: string): string =>
  header
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

/** Guess the mapping from the header row; each file column is used at most once. */
export function guessMapping(headers: readonly string[]): Mapping {
  const normal = headers.map(normaliseHeader);
  const used = new Set<number>();
  const mapping = Object.fromEntries(IMPORT_FIELDS.map((f) => [f, null])) as Mapping;
  for (const field of IMPORT_FIELDS) {
    const spellings = [normaliseHeader(field), ...SYNONYMS[field]];
    const index = normal.findIndex((h, i) => !used.has(i) && h !== '' && spellings.includes(h));
    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  }
  return mapping;
}

/** Required fields that have no column. */
export function missingRequired(mapping: Mapping): ImportField[] {
  return REQUIRED_IMPORT_FIELDS.filter((f) => mapping[f] === null);
}

/** True when two fields point at the same column. */
export function duplicateColumns(mapping: Mapping): ImportField[] {
  const seen = new Map<number, ImportField>();
  const dupes: ImportField[] = [];
  for (const field of IMPORT_FIELDS) {
    const index = mapping[field];
    if (index === null) continue;
    if (seen.has(index)) dupes.push(field);
    else seen.set(index, field);
  }
  return dupes;
}

/** The rows the API takes: mapped columns only, trimmed, empty cells left out, capped in length. */
export function applyMapping(rows: readonly (readonly string[])[], mapping: Mapping): ImportRow[] {
  return rows.map((cells) => {
    const row: ImportRow = {};
    for (const field of IMPORT_FIELDS) {
      const index = mapping[field];
      if (index === null) continue;
      const value = (cells[index] ?? '').trim().slice(0, MAX_CELL_LENGTH);
      if (value !== '') row[field] = value;
    }
    return row;
  });
}
