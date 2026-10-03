import {
  createStudentSchema,
  updateStudentSchema,
  type CreateStudentRequest,
  type StudentProfile,
  type UpdateStudentRequest,
} from '@remix/types/api';

/**
 * The add/edit student form keeps everything as plain strings (what inputs give) and turns it
 * into the API's request shape here, so conversions and validation are testable without React.
 */

export interface GuardianValues {
  name: string;
  relation: 'mother' | 'father' | 'guardian' | 'other';
  phone: string;
  smsOptIn: boolean;
}

export interface StudentFormValues {
  displayName: string;
  phone: string;
  school: string;
  /** '' = not set. */
  alYear: string;
  /** '' = not set. */
  medium: string;
  under18: boolean;
  consentGivenBy: string;
  consentMethod: 'paper_form' | 'verbal' | 'online';
  guardians: GuardianValues[];
  classIds: string[];
  enrolFrom: string;
  sendWelcomeSms: boolean;
}

export const MAX_GUARDIANS = 3;

export const blankGuardian = (): GuardianValues => ({
  name: '',
  relation: 'mother',
  phone: '',
  smsOptIn: true,
});

export function emptyValues(enrolFrom: string): StudentFormValues {
  return {
    displayName: '',
    phone: '',
    school: '',
    alYear: '',
    medium: '',
    under18: false,
    consentGivenBy: '',
    consentMethod: 'paper_form',
    guardians: [],
    classIds: [],
    enrolFrom,
    sendWelcomeSms: true,
  };
}

export function valuesFromProfile(p: StudentProfile): StudentFormValues {
  return {
    ...emptyValues(''),
    displayName: p.displayName,
    phone: p.phone,
    school: p.school ?? '',
    alYear: p.alYear?.toString() ?? '',
    medium: p.medium ?? '',
    under18: p.under18,
    consentGivenBy: p.consent?.givenBy ?? '',
    consentMethod: p.consent?.method ?? 'paper_form',
    guardians: p.guardians.map((g) => ({
      name: g.name,
      relation: g.relation,
      phone: g.phone,
      smsOptIn: g.smsOptIn,
    })),
  };
}

/** A single checked checkbox gives a string (or false), several give an array. */
const toIds = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((x): x is string => typeof x === 'string')
    : typeof value === 'string'
      ? [value]
      : [];

const blank = (g: GuardianValues) => !g.name.trim() && !g.phone.trim();
const keptGuardians = (v: StudentFormValues) => v.guardians.filter((g) => !blank(g));
const MEDIUM_VALUES = ['sinhala', 'english', 'tamil'] as const;
const mediumOf = (v: string) => MEDIUM_VALUES.find((m) => m === v);

export function createPayload(v: StudentFormValues): CreateStudentRequest {
  const school = v.school.trim();
  const medium = mediumOf(v.medium);
  return {
    displayName: v.displayName,
    phone: v.phone,
    ...(school ? { school } : {}),
    ...(v.alYear ? { alYear: Number(v.alYear) } : {}),
    ...(medium ? { medium } : {}),
    under18: v.under18,
    ...(v.under18 ? { consent: { givenBy: v.consentGivenBy, method: v.consentMethod } } : {}),
    guardians: keptGuardians(v),
    classIds: toIds(v.classIds),
    ...(v.enrolFrom ? { enrolFrom: v.enrolFrom } : {}),
    sendWelcomeSms: v.sendWelcomeSms,
  };
}

/**
 * Edit sends the whole form, except consent, which is only (re)recorded when the student is
 * under 18 and nothing is on file yet or the person changed who gave it or how.
 */
export function updatePayload(
  v: StudentFormValues,
  original: StudentProfile,
): UpdateStudentRequest {
  const school = v.school.trim();
  const consentChanged =
    original.consent === null ||
    original.consent.givenBy !== v.consentGivenBy ||
    original.consent.method !== v.consentMethod;
  return {
    displayName: v.displayName,
    phone: v.phone,
    school: school || null,
    alYear: v.alYear ? Number(v.alYear) : null,
    medium: mediumOf(v.medium) ?? null,
    under18: v.under18,
    ...(v.under18 && consentChanged
      ? { consent: { givenBy: v.consentGivenBy, method: v.consentMethod } }
      : {}),
    guardians: keptGuardians(v),
  };
}

export interface FieldIssue {
  /** Path in the form (`guardians.1.phone`, `consentGivenBy`). */
  field: string;
  /** Which message to show (key under `students.form.errors`). */
  message: 'name' | 'phone' | 'alYear' | 'consent' | 'guardianName' | 'guardianPhone' | 'invalid';
}

const FORM_PATH: Record<string, string> = {
  consent: 'consentGivenBy',
  'consent.givenBy': 'consentGivenBy',
  'consent.method': 'consentMethod',
};

function messageFor(path: readonly PropertyKey[]): FieldIssue['message'] {
  const [head, , leaf] = path;
  if (head === 'displayName') return 'name';
  if (head === 'phone') return 'phone';
  if (head === 'alYear') return 'alYear';
  if (head === 'consent') return 'consent';
  if (head === 'guardians' && leaf === 'name') return 'guardianName';
  if (head === 'guardians' && leaf === 'phone') return 'guardianPhone';
  return 'invalid';
}

/** Validates with the API's own schema; returns the issues to show next to the fields. */
export function validateStudent(
  mode: 'create' | 'edit',
  payload: CreateStudentRequest | UpdateStudentRequest,
): FieldIssue[] {
  const result =
    mode === 'create'
      ? createStudentSchema.safeParse(payload)
      : updateStudentSchema.safeParse(payload);
  if (result.success) return [];
  const seen = new Set<string>();
  const issues: FieldIssue[] = [];
  for (const issue of result.error.issues) {
    const joined = issue.path.join('.');
    const field = FORM_PATH[joined] ?? joined;
    if (seen.has(field)) continue;
    seen.add(field);
    issues.push({ field, message: messageFor(issue.path) });
  }
  return issues;
}
