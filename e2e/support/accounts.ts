// Seeded dev logins (packages/db/README.md "Seed logins"). Every seeded user has this password;
// it exists only in the dev seed and the CI database, never in a real environment.
export const PASSWORD = 'remix-dev-password';

/** Kamal Physics student BR-n: phone `+9471` + n padded to 7 digits, typed the local way. */
export const kamalStudentPhone = (n: number): string => `071${String(n).padStart(7, '0')}`;
/** Royal Science student RS-n: `+9472` + n padded to 7 digits. */
export const royalStudentPhone = (n: number): string => `072${String(n).padStart(7, '0')}`;

export const NIMALI = {
  name: 'Nimali Perera',
  phone: '071 000 1042',
  /** Her enrolments in the deterministic seed (alphabetical). */
  classes: ['2027 A/L Physics Theory', '2027 A/L Revision'],
} as const;

export const KAMAL = { name: 'Kamal Jayasinghe', email: 'kamal@kamalphysics.test' } as const;
export const SUNIL = { name: 'Sunil Perera', email: 'sunil@kamalphysics.test' } as const;
export const CLOSED_OWNER = { name: 'Chaminda Silva', phone: '077 000 3300' } as const;

/** Class names of the Kamal Physics seed (packages/db/src/seed/data.ts). */
export const KAMAL_CLASSES = [
  '2027 A/L Physics Theory',
  '2027 A/L Revision',
  '2026 A/L Paper Class',
  '2026 A/L Revision',
  '2028 A/L Physics Theory',
  'Grade 11 O/L Science',
] as const;
export const OTHER_TENANT_CLASSES = [
  '2027 A/L Chemistry Theory',
  '2026 A/L Chemistry Revision',
  '2026 A/L Combined Maths',
] as const;

/**
 * Students for journeys other than M1. The login limiter allows 5 attempts a minute per phone,
 * so no journey shares a student with another one, and the two projects use different pools.
 */
const KAMAL_POOL = [
  [871, 934, 1077, 1150, 1187], // BR-0988 is a seeded disabled account
  [1203, 1300, 1301, 1302, 1303, 1304],
] as const;
const ROYAL_POOL = [
  [1, 2, 3],
  [11, 12, 13],
] as const;

const poolIndex = (project: string): 0 | 1 => (project === 'mobile-chrome' ? 1 : 0);

export function kamalStudent(journey: number, project: string): string {
  const n = KAMAL_POOL[poolIndex(project)][journey];
  if (n === undefined) throw new Error(`No Kamal student for journey ${journey}`);
  return kamalStudentPhone(n);
}

export function royalStudent(journey: number, project: string): string {
  const n = ROYAL_POOL[poolIndex(project)][journey];
  if (n === undefined) throw new Error(`No Royal student for journey ${journey}`);
  return royalStudentPhone(n);
}
