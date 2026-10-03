import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, instant, tenantId, timestamps } from './columns';
import { appLocale, consentMethod, medium, staffRole, userKind, userStatus } from './enums';
import { tenants } from './tenants';

/**
 * Students and institute staff of one tenant. A phone number is unique per tenant, not globally:
 * the same person can study at two institutes with separate accounts.
 */
export const tenantUsers = pgTable(
  'tenant_users',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    kind: userKind('kind').notNull(),
    /** E.164, e.g. +94771234567 (normalised by `sriLankaMobile` before it gets here). */
    phone: text('phone'),
    email: text('email'),
    /** Argon2id PHC string. Null while an invitation is pending. */
    passwordHash: text('password_hash'),
    /** Set for temporary passwords (tenant:create, resets) — the next login must change it. */
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    displayName: text('display_name').notNull(),
    status: userStatus('status').notNull().default('active'),
    locale: appLocale('locale').notNull().default('en'),
    /** Consecutive wrong passwords since the last successful sign-in or unlock (AUTH-09). */
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    /** Set after `LOGIN_LIMITS.lockoutAfterFailures`; cleared by an `unlock` SMS code. */
    lockedAt: instant('locked_at'),
    lastSignInAt: instant('last_sign_in_at'),
    ...timestamps(),
  },
  (t) => [
    // Target of the composite foreign keys below: child rows must share the user's tenant.
    unique('tenant_users_tenant_id_id_key').on(t.tenantId, t.id),
    uniqueIndex('tenant_users_tenant_phone_key').on(t.tenantId, t.phone),
    uniqueIndex('tenant_users_tenant_email_key').on(t.tenantId, sql`lower(${t.email})`),
    check('tenant_users_phone_e164', sql`${t.phone} ~ '^[+][1-9][0-9]{7,14}$'`),
    check(
      'tenant_users_email_format',
      sql`char_length(${t.email}) <= 254 AND ${t.email} ~ '^[^@[:space:]]+@[^@[:space:]]+$'`,
    ),
    check('tenant_users_has_identifier', sql`${t.phone} IS NOT NULL OR ${t.email} IS NOT NULL`),
    check('tenant_users_student_has_phone', sql`${t.kind} <> 'student' OR ${t.phone} IS NOT NULL`),
    check(
      'tenant_users_active_has_password',
      sql`${t.status} <> 'active' OR ${t.passwordHash} IS NOT NULL`,
    ),
    check('tenant_users_display_name_length', sql`char_length(${t.displayName}) BETWEEN 1 AND 120`),
    check('tenant_users_failed_login_count_range', sql`${t.failedLoginCount} BETWEEN 0 AND 1000`),
  ],
);

/**
 * Staff role grants. `class_scope` limits a teacher to the listed classes; null (or empty) means
 * only the classes the teacher is assigned to — never "all classes" (the API's `visibleClassIds`).
 * Array elements cannot carry foreign keys; RLS still hides other tenants' classes.
 */
export const staffRoles = pgTable(
  'staff_roles',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    role: staffRole('role').notNull(),
    classScope: uuid('class_scope').array(),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'staff_roles_user_fk',
      columns: [t.tenantId, t.userId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }).onDelete('cascade'),
    unique('staff_roles_tenant_id_id_key').on(t.tenantId, t.id),
    unique('staff_roles_tenant_user_role_key').on(t.tenantId, t.userId, t.role),
  ],
);

/** Student profile, 1:1 with a `tenant_users` row of kind `student`. */
export const students = pgTable(
  'students',
  {
    userId: uuid('user_id').primaryKey(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    /** Institute-facing number printed on cards, e.g. "BR-1042". */
    studentNo: text('student_no').notNull(),
    school: text('school'),
    /** Year the student sits the A/L exam, e.g. 2027. */
    alYear: smallint('al_year'),
    medium: medium('medium'),
    /** PAR-03 — the student is a minor; parental consent below is then mandatory. */
    under18: boolean('under18').notNull().default(false),
    consentGivenBy: text('consent_given_by'),
    consentMethod: consentMethod('consent_method'),
    consentRecordedAt: instant('consent_recorded_at'),
    consentRecordedBy: uuid('consent_recorded_by'),
    archivedAt: instant('archived_at'),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'students_consent_recorded_by_fk',
      columns: [t.tenantId, t.consentRecordedBy],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    check(
      'students_under18_has_consent',
      sql`NOT ${t.under18} OR (${t.consentGivenBy} IS NOT NULL AND ${t.consentMethod} IS NOT NULL AND ${t.consentRecordedAt} IS NOT NULL)`,
    ),
    check(
      'students_consent_given_by_length',
      sql`char_length(${t.consentGivenBy}) BETWEEN 1 AND 120`,
    ),
    foreignKey({
      name: 'students_user_fk',
      columns: [t.tenantId, t.userId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }).onDelete('cascade'),
    unique('students_tenant_id_user_id_key').on(t.tenantId, t.userId),
    unique('students_tenant_student_no_key').on(t.tenantId, t.studentNo),
    index('students_tenant_active_idx')
      .on(t.tenantId)
      .where(sql`${t.archivedAt} IS NULL`),
    check('students_student_no_length', sql`char_length(${t.studentNo}) BETWEEN 1 AND 32`),
    check('students_al_year_range', sql`${t.alYear} BETWEEN 2000 AND 2100`),
  ],
);
