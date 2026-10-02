import type { ClassPlace, Medium, PlanId, StaffRole, TenantStatus } from '@remix/types';

/**
 * Dev-only sample data in the style of the designs (Kamal Physics, Nimali Perera BR-1042).
 * Obviously fictional; phone numbers follow a fixed pattern derived from the student number.
 */

/** One password for every seeded user. Dev only — documented in README.md, never used in prod. */
export const SEED_PASSWORD = 'remix-dev-password';

export interface SeedStaff {
  name: string;
  phone: string;
  email?: string;
  roles: readonly StaffRole[];
}

export interface SeedClass {
  name: string;
  grade: string;
  medium: Medium;
  /** Index into the tenant's `staff`. */
  teacher: number;
  feeCents: number;
  place: ClassPlace;
  startsOn: string;
  /** A/L exam year of the students who take it; null for O/L. */
  alYear: number | null;
  /** [ISO weekday, 'HH:MM' Asia/Colombo, minutes] */
  schedules: ReadonlyArray<readonly [number, string, number]>;
}

export interface SeedTenant {
  slug: string;
  name: string;
  plan: PlanId;
  status: TenantStatus;
  studentNoPrefix: string;
  /** Counter value before the first seeded student (first number = counterStart + 1). */
  counterStart: number;
  students: number;
  /** Students' phones are +94 <phoneBase> <student number padded to 7 digits>. */
  phoneBase: string;
  staff: readonly SeedStaff[];
  classes: readonly SeedClass[];
  /** Fixed names for some student numbers (the ones the designs show). */
  namedStudents: Readonly<Record<number, string>>;
  domains: ReadonlyArray<{ host: string; verified: boolean; primary: boolean }>;
}

export const SEED_TENANTS: readonly SeedTenant[] = [
  {
    slug: 'kamalphysics',
    name: 'Kamal Physics',
    plan: 'institute',
    status: 'active',
    studentNoPrefix: 'BR',
    counterStart: 800,
    students: 2_000,
    phoneBase: '71',
    staff: [
      {
        name: 'Kamal Jayasinghe',
        phone: '+94770001180',
        email: 'kamal@kamalphysics.test',
        roles: ['owner', 'teacher'],
      },
      {
        name: 'Sunil Perera',
        phone: '+94770001181',
        email: 'sunil@kamalphysics.test',
        roles: ['admin'],
      },
      { name: 'Dulmini Rathnayake', phone: '+94770001182', roles: ['cashier'] },
      { name: 'Ravindu Bandara', phone: '+94770001183', roles: ['teacher'] },
    ],
    classes: [
      {
        name: '2027 A/L Physics Theory',
        grade: '2027 A/L',
        medium: 'sinhala',
        teacher: 0,
        feeCents: 250_000,
        place: 'hybrid',
        startsOn: '2025-02-01',
        alYear: 2027,
        schedules: [
          [6, '08:00', 180],
          [3, '19:00', 120],
        ],
      },
      {
        name: '2027 A/L Revision',
        grade: '2027 A/L',
        medium: 'sinhala',
        teacher: 0,
        feeCents: 150_000,
        place: 'hall',
        startsOn: '2026-01-01',
        alYear: 2027,
        schedules: [[6, '14:00', 120]],
      },
      {
        name: '2026 A/L Paper Class',
        grade: '2026 A/L',
        medium: 'sinhala',
        teacher: 0,
        feeCents: 200_000,
        place: 'hall',
        startsOn: '2025-06-01',
        alYear: 2026,
        schedules: [[7, '08:00', 180]],
      },
      {
        name: '2026 A/L Revision',
        grade: '2026 A/L',
        medium: 'sinhala',
        teacher: 3,
        feeCents: 150_000,
        place: 'online',
        startsOn: '2025-08-01',
        alYear: 2026,
        schedules: [[2, '19:00', 120]],
      },
      {
        name: '2028 A/L Physics Theory',
        grade: '2028 A/L',
        medium: 'english',
        teacher: 3,
        feeCents: 250_000,
        place: 'hybrid',
        startsOn: '2026-02-01',
        alYear: 2028,
        schedules: [[7, '14:00', 180]],
      },
      {
        name: 'Grade 11 O/L Science',
        grade: 'Grade 11',
        medium: 'sinhala',
        teacher: 3,
        feeCents: 120_000,
        place: 'hall',
        startsOn: '2026-01-01',
        alYear: null,
        schedules: [[5, '16:00', 120]],
      },
    ],
    namedStudents: {
      871: 'Ishara Dissanayake',
      934: 'Kavindi Herath',
      988: 'Pasindu Gunawardena',
      1042: 'Nimali Perera',
      1077: 'Tharindu Silva',
      1150: 'Hiruni Senanayake',
      1187: 'Sanduni Fernando',
      1203: 'Dilshan Weerasinghe',
    },
    domains: [
      { host: 'kamalphysics.test', verified: true, primary: true },
      { host: 'pending.kamalphysics.test', verified: false, primary: false },
    ],
  },
  {
    slug: 'royalscience',
    name: 'Royal Science Classes',
    plan: 'tutor',
    status: 'active',
    studentNoPrefix: 'RS',
    counterStart: 0,
    students: 40,
    phoneBase: '72',
    staff: [{ name: 'Ruwan Wickramasinghe', phone: '+94770002200', roles: ['owner', 'teacher'] }],
    classes: [
      {
        name: '2027 A/L Chemistry Theory',
        grade: '2027 A/L',
        medium: 'sinhala',
        teacher: 0,
        feeCents: 200_000,
        place: 'online',
        startsOn: '2026-01-01',
        alYear: 2027,
        schedules: [[1, '18:00', 120]],
      },
      {
        name: '2026 A/L Chemistry Revision',
        grade: '2026 A/L',
        medium: 'sinhala',
        teacher: 0,
        feeCents: 150_000,
        place: 'online',
        startsOn: '2025-09-01',
        alYear: 2026,
        schedules: [[4, '18:00', 120]],
      },
    ],
    namedStudents: {},
    domains: [],
  },
  {
    slug: 'closedacademy',
    name: 'Closed Academy',
    plan: 'tutor',
    status: 'suspended',
    studentNoPrefix: 'CA',
    counterStart: 0,
    students: 5,
    phoneBase: '75',
    staff: [{ name: 'Chaminda Silva', phone: '+94770003300', roles: ['owner', 'teacher'] }],
    classes: [
      {
        name: '2026 A/L Combined Maths',
        grade: '2026 A/L',
        medium: 'tamil',
        teacher: 0,
        feeCents: 180_000,
        place: 'hall',
        startsOn: '2025-03-01',
        alYear: 2026,
        schedules: [[6, '09:00', 120]],
      },
    ],
    namedStudents: {},
    domains: [],
  },
];

export const FIRST_NAMES = [
  'Amaya',
  'Anjali',
  'Ashen',
  'Chamath',
  'Chathuri',
  'Dasun',
  'Dinithi',
  'Gayan',
  'Hasini',
  'Heshan',
  'Imesha',
  'Isuru',
  'Janani',
  'Kasun',
  'Kaveesha',
  'Lahiru',
  'Malsha',
  'Minura',
  'Nadeesha',
  'Nethmi',
  'Oshadi',
  'Pathum',
  'Piumi',
  'Ravindu',
  'Sachini',
  'Sahan',
  'Sanjana',
  'Senuri',
  'Shehan',
  'Tharushi',
  'Udara',
  'Vihanga',
  'Yasiru',
  'Yohani',
  'Kavya',
  'Arun',
  'Priya',
  'Karthik',
  'Nilu',
  'Ramesh',
] as const;

export const LAST_NAMES = [
  'Perera',
  'Fernando',
  'Silva',
  'Jayasinghe',
  'Bandara',
  'Wickramasinghe',
  'Dissanayake',
  'Herath',
  'Gunawardena',
  'Rathnayake',
  'Senanayake',
  'Weerasinghe',
  'Ranasinghe',
  'Kumara',
  'Jayawardena',
  'Amarasinghe',
  'Karunaratne',
  'Liyanage',
  'Samarakoon',
  'Wijesinghe',
  'Ekanayake',
  'Abeysekara',
  'Sivakumar',
  'Rajapaksha',
  'Mendis',
  'De Silva',
  'Peiris',
  'Nanayakkara',
  'Kodikara',
  'Tennakoon',
] as const;

export const SCHOOLS = [
  'Dharmaraja College',
  'Mahamaya Girls College',
  'Kingswood College',
  'Girls High School Kandy',
  'Sri Rahula College',
  'Vidyartha College',
  'Pushpadana Girls College',
  'Sri Sumangala College',
] as const;
