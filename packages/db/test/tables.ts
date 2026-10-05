import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Db } from '../src/client';
import * as schema from '../src/schema';
import { uniqueTag } from './support';

/**
 * The isolation suite's factory map. EVERY table in `public` must have an entry: the suite fails
 * at compile time (`satisfies Record<TableName, …>`) and at run time (catalog comparison) when one
 * is missing. See README → "Adding a table".
 */

/** Names of all Drizzle tables in the schema, e.g. 'tenants' | 'tenant_users' | … */
type SchemaExports = typeof schema;
export type TableName = {
  [K in keyof SchemaExports]: SchemaExports[K] extends PgTable
    ? SchemaExports[K]['_']['name']
    : never;
}[keyof SchemaExports];

/**
 * What `remix_app` may do with a table. Drives both the expected grants and which behaviour the
 * isolation tests assert (0 rows affected vs permission denied).
 * - root: the tenants table itself — SELECT own row only.
 * - settings: like root, plus UPDATE on a few settings columns of the own row (column-level grant,
 *   migrations/0008; the exact columns are asserted in classes.test.ts). No INSERT or DELETE.
 * - read: SELECT within the tenant only (rows managed by the owner/platform).
 * - append: SELECT + INSERT within the tenant (audit trail).
 * - full: SELECT, INSERT, UPDATE, DELETE within the tenant.
 */
export type Access = 'root' | 'settings' | 'read' | 'append' | 'projection' | 'full';

export const APP_PRIVILEGES: Record<Access, readonly string[]> = {
  root: ['SELECT'],
  settings: ['SELECT', 'UPDATE'],
  read: ['SELECT'],
  append: ['INSERT', 'SELECT'],
  projection: ['INSERT', 'SELECT', 'UPDATE'],
  full: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
};

/** One tenant's full set of rows, created as the owner (RLS bypassed). */
export interface World {
  tag: string;
  tenantId: string;
  slug: string;
  /** Verified custom domain of this tenant. */
  domainHost: string;
  domainId: string;
  staffUserId: string;
  studentUserId: string;
  /** A student-kind user without a `students` row, so tests can add one. */
  spareStudentUserId: string;
  staffRoleId: string;
  deviceId: string;
  sessionId: string;
  hallId: string;
  classId: string;
  scheduleId: string;
  enrollmentId: string;
  guardianId: string;
  auditLogId: string;
  otpChallengeId: string;
  authTicketId: string;
  staffInviteId: string;
  importJobId: string;
  invoiceId: string;
  lineId: string;
  paymentId: string;
  sparePaymentId: string;
  spareEnrollmentId: string;
  receiptId: string;
  settingsId: string;
  cardId: string;
}

type Row = Record<string, unknown>;

export interface TableSpec {
  access: Access;
  /** Singleton insert control is tested separately on a tenant without a settings row. */
  singleton?: boolean;
  /** Column compared with app_tenant_id() by the policy. */
  tenantColumn: 'tenant_id' | 'id';
  /** Identifies this world's row of the table. */
  key(w: World): Row;
  /** A new, valid row for `w` (column → value) that does not clash with the world's rows. */
  fresh(w: World): Row;
  /** Rows for `home` whose parent ids belong to `other`; each must be rejected by a composite FK. */
  crossTenantRefs?: Record<string, (home: World, other: World) => Row>;
}

const hash = (char: string) => char.repeat(64);
const freshCard = (w: World): Row => ({
  tenant_id: w.tenantId,
  student_id: w.studentUserId,
  code: randomUUID().replaceAll('-', '').toUpperCase(),
  format: 'qr',
  source: 'linked',
  status: 'revoked',
  issued_by: w.staffUserId,
  revoked_at: new Date(),
  revoked_by: w.staffUserId,
  revoke_reason: 'Lost card',
});
const inOneHour = () => new Date(Date.now() + 3_600_000);

const freshStaffRole = (w: World): Row => ({
  tenant_id: w.tenantId,
  user_id: w.staffUserId,
  role: 'cashier',
});
const freshStudent = (w: World): Row => ({
  tenant_id: w.tenantId,
  user_id: w.spareStudentUserId,
  student_no: 'IS-9999',
});
const freshDevice = (w: World): Row => ({
  tenant_id: w.tenantId,
  user_id: w.studentUserId,
  token_hash: hash('c'),
  label: 'Fresh device',
});
const freshSession = (w: World): Row => ({
  tenant_id: w.tenantId,
  user_id: w.studentUserId,
  token_hash: hash('d'),
  family_id: randomUUID(),
  expires_at: inOneHour(),
});
const freshHall = (w: World): Row => ({
  tenant_id: w.tenantId,
  name: 'Fresh hall',
  capacity: 80,
});
const freshClass = (w: World): Row => ({
  tenant_id: w.tenantId,
  name: 'Fresh class',
  grade: '2028 A/L',
  medium: 'english',
  fee_cents: 150_000,
  place: 'online',
});
const freshSchedule = (w: World): Row => ({
  tenant_id: w.tenantId,
  class_id: w.classId,
  weekday: 3,
  start_time: '18:30',
  duration_minutes: 90,
});
const freshEnrollment = (w: World): Row => ({
  tenant_id: w.tenantId,
  class_id: w.classId,
  student_id: w.studentUserId,
  from_month: '2026-10-01',
});

const freshOtpChallenge = (w: World): Row => ({
  tenant_id: w.tenantId,
  phone: '+94770000002',
  user_id: w.studentUserId,
  purpose: 'password_reset',
  code_hash: hash('f'),
  expires_at: inOneHour(),
});
const freshAuthTicket = (w: World): Row => ({
  tenant_id: w.tenantId,
  user_id: w.studentUserId,
  kind: 'device_limit',
  token_hash: hash('g'),
  expires_at: inOneHour(),
});
const freshGuardian = (w: World): Row => ({
  tenant_id: w.tenantId,
  student_id: w.studentUserId,
  name: 'Fresh Guardian',
  relation: 'father',
  phone: '+94770000088',
});
const freshStaffInvite = (w: World): Row => ({
  tenant_id: w.tenantId,
  display_name: 'Fresh Invitee',
  phone: '+94770000008',
  role: 'teacher',
  token_hash: hash('h'),
  invited_by: w.staffUserId,
  expires_at: inOneHour(),
});

const freshImportJob = (w: World): Row => ({
  tenant_id: w.tenantId,
  created_by: w.staffUserId,
  options: JSON.stringify({ sendWelcomeSms: false }),
  input: JSON.stringify([]),
});

const freshInvoice = (w: World): Row => ({
  tenant_id: w.tenantId,
  student_id: w.studentUserId,
  number: 'IS-I-26-10-IS-0001',
  month: '2026-10-01',
  due_on: '2026-10-05',
});
const freshLine = (w: World): Row => ({
  tenant_id: w.tenantId,
  invoice_id: w.invoiceId,
  enrollment_id: w.spareEnrollmentId,
  class_id: w.classId,
  month: '2026-09-01',
  amount_cents: 250000,
});
const freshPayment = (w: World): Row => ({
  tenant_id: w.tenantId,
  student_id: w.studentUserId,
  method: 'cash',
  amount_cents: 250000,
  idempotency_key: 'fresh-payment',
});
const freshAllocation = (w: World): Row => ({
  tenant_id: w.tenantId,
  payment_id: w.sparePaymentId,
  invoice_line_id: w.lineId,
  amount_cents: 1,
});
const freshReceipt = (w: World): Row => ({
  tenant_id: w.tenantId,
  payment_id: w.sparePaymentId,
  number: 'IS-R-26-00002',
});

export const TABLES = {
  tenant_integrations: {
    access: 'projection',
    singleton: true,
    tenantColumn: 'tenant_id',
    key: (w) => ({ tenant_id: w.tenantId, kind: 'payhere' }),
    fresh: (w) => ({ tenant_id: w.tenantId, kind: 'payhere', config: '{}' }),
  },
  tenant_settings: {
    access: 'projection',
    singleton: true,
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.settingsId }),
    fresh: (w) => ({ tenant_id: w.tenantId }),
  },
  invoices: {
    access: 'projection',
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.invoiceId }),
    fresh: freshInvoice,
    crossTenantRefs: { student: (a, b) => ({ ...freshInvoice(a), student_id: b.studentUserId }) },
  },
  invoice_lines: {
    access: 'projection',
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.lineId }),
    fresh: freshLine,
    crossTenantRefs: {
      invoice: (a, b) => ({ ...freshLine(a), invoice_id: b.invoiceId }),
      enrollment: (a, b) => ({ ...freshLine(a), enrollment_id: b.spareEnrollmentId }),
      class: (a, b) => ({ ...freshLine(a), class_id: b.classId }),
    },
  },
  payments: {
    access: 'append',
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.paymentId }),
    fresh: freshPayment,
    crossTenantRefs: {
      student: (a, b) => ({ ...freshPayment(a), student_id: b.studentUserId }),
      receivedBy: (a, b) => ({ ...freshPayment(a), received_by: b.staffUserId }),
      reversal: (a, b) => ({
        ...freshPayment(a),
        method: 'reversal',
        amount_cents: -250000,
        reverses_payment_id: b.paymentId,
      }),
    },
  },
  payment_allocations: {
    access: 'append',
    tenantColumn: 'tenant_id',
    key: (w) => ({ payment_id: w.paymentId, invoice_line_id: w.lineId }),
    fresh: freshAllocation,
    crossTenantRefs: {
      payment: (a, b) => ({ ...freshAllocation(a), payment_id: b.sparePaymentId }),
      line: (a, b) => ({ ...freshAllocation(a), invoice_line_id: b.lineId }),
    },
  },
  receipts: {
    access: 'projection',
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.receiptId }),
    fresh: freshReceipt,
    crossTenantRefs: { payment: (a, b) => ({ ...freshReceipt(a), payment_id: b.sparePaymentId }) },
  },
  tenants: {
    access: 'settings',
    tenantColumn: 'id',
    key: (w) => ({ id: w.tenantId }),
    fresh: (w) => ({
      slug: `iso-fresh-${w.tag}`,
      name: 'Fresh tenant',
      plan: 'tutor',
      student_no_prefix: 'FR',
    }),
  },
  tenant_domains: {
    access: 'read',
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.domainId }),
    fresh: (w) => ({ tenant_id: w.tenantId, host: `fresh-${w.tag}.example.test` }),
  },
  tenant_users: {
    access: 'full',
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.staffUserId }),
    fresh: (w) => ({
      tenant_id: w.tenantId,
      kind: 'staff',
      phone: '+94770000009',
      display_name: 'Fresh Staff',
      password_hash: 'test-hash',
    }),
  },
  staff_roles: {
    access: 'full',
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.staffRoleId }),
    fresh: freshStaffRole,
    crossTenantRefs: {
      user: (home, other) => ({ ...freshStaffRole(home), user_id: other.staffUserId }),
    },
  },
  students: {
    access: 'full',
    tenantColumn: 'tenant_id',
    key: (w) => ({ user_id: w.studentUserId }),
    fresh: freshStudent,
    crossTenantRefs: {
      user: (home, other) => ({ ...freshStudent(home), user_id: other.spareStudentUserId }),
    },
  },
  student_cards: {
    access: 'projection',
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.cardId }),
    fresh: freshCard,
    crossTenantRefs: {
      student: (a, b) => ({ ...freshCard(a), student_id: b.studentUserId }),
      issuedBy: (a, b) => ({ ...freshCard(a), issued_by: b.staffUserId }),
      revokedBy: (a, b) => ({ ...freshCard(a), revoked_by: b.staffUserId }),
    },
  },
  devices: {
    access: 'full',
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.deviceId }),
    fresh: freshDevice,
    crossTenantRefs: {
      user: (home, other) => ({ ...freshDevice(home), user_id: other.studentUserId }),
      signedOutBy: (home, other) => ({
        ...freshDevice(home),
        signed_out_at: new Date(),
        signed_out_by: other.staffUserId,
      }),
    },
  },
  sessions: {
    access: 'full',
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.sessionId }),
    fresh: freshSession,
    crossTenantRefs: {
      user: (home, other) => ({ ...freshSession(home), user_id: other.studentUserId }),
      device: (home, other) => ({ ...freshSession(home), device_id: other.deviceId }),
    },
  },
  halls: {
    access: 'full',
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.hallId }),
    fresh: freshHall,
  },
  classes: {
    access: 'full',
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.classId }),
    fresh: freshClass,
    crossTenantRefs: {
      teacher: (home, other) => ({ ...freshClass(home), teacher_id: other.staffUserId }),
      hall: (home, other) => ({ ...freshClass(home), hall_id: other.hallId }),
    },
  },
  class_schedules: {
    access: 'full',
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.scheduleId }),
    fresh: freshSchedule,
    crossTenantRefs: {
      class: (home, other) => ({ ...freshSchedule(home), class_id: other.classId }),
    },
  },
  enrollments: {
    access: 'full',
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.enrollmentId }),
    fresh: freshEnrollment,
    crossTenantRefs: {
      class: (home, other) => ({ ...freshEnrollment(home), class_id: other.classId }),
      student: (home, other) => ({ ...freshEnrollment(home), student_id: other.studentUserId }),
    },
  },
  guardians: {
    access: 'full',
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.guardianId }),
    fresh: freshGuardian,
    crossTenantRefs: {
      student: (home, other) => ({ ...freshGuardian(home), student_id: other.studentUserId }),
    },
  },
  tenant_counters: {
    access: 'full',
    tenantColumn: 'tenant_id',
    key: (w) => ({ tenant_id: w.tenantId, kind: 'student', period: '' }),
    fresh: (w) => ({ tenant_id: w.tenantId, kind: 'receipt', period: '2026', value: 1 }),
  },
  audit_logs: {
    access: 'append',
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.auditLogId }),
    fresh: (w) => ({
      tenant_id: w.tenantId,
      actor_kind: 'system',
      action: 'test.fresh',
      entity: 'tenant',
      entity_id: w.tenantId,
    }),
  },
  otp_challenges: {
    access: 'full',
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.otpChallengeId }),
    fresh: freshOtpChallenge,
    crossTenantRefs: {
      user: (home, other) => ({ ...freshOtpChallenge(home), user_id: other.studentUserId }),
    },
  },
  auth_tickets: {
    access: 'full',
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.authTicketId }),
    fresh: freshAuthTicket,
    crossTenantRefs: {
      user: (home, other) => ({ ...freshAuthTicket(home), user_id: other.studentUserId }),
    },
  },
  staff_invites: {
    access: 'full',
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.staffInviteId }),
    fresh: freshStaffInvite,
    crossTenantRefs: {
      invitedBy: (home, other) => ({ ...freshStaffInvite(home), invited_by: other.staffUserId }),
      acceptedUser: (home, other) => ({
        ...freshStaffInvite(home),
        accepted_at: new Date(),
        accepted_user_id: other.staffUserId,
      }),
    },
  },
  import_jobs: {
    access: 'full',
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.importJobId }),
    fresh: freshImportJob,
    crossTenantRefs: {
      createdBy: (home, other) => ({ ...freshImportJob(home), created_by: other.staffUserId }),
    },
  },
} satisfies Record<TableName, TableSpec>;

export const TABLE_NAMES = Object.keys(TABLES) as TableName[];

export function spec(name: TableName): TableSpec {
  return TABLES[name];
}

// Generic, parameterised statements: identifiers via sql.identifier, values as bind parameters.

const columnList = (row: Row) =>
  sql.join(
    Object.keys(row).map((column) => sql.identifier(column)),
    sql`, `,
  );
const valueList = (row: Row) =>
  sql.join(
    Object.values(row).map((value) => sql`${value}`),
    sql`, `,
  );

export function whereKey(key: Row): SQL {
  return sql.join(
    Object.entries(key).map(([column, value]) => sql`${sql.identifier(column)} = ${value}`),
    sql` and `,
  );
}

export const insertRow = (table: string, row: Row) =>
  sql`insert into ${sql.identifier(table)} (${columnList(row)}) values (${valueList(row)})`;

export const selectTenantIds = (table: string, tenantColumn: string) =>
  sql`select ${sql.identifier(tenantColumn)}::text as tenant from ${sql.identifier(table)}`;

/** A no-op update (sets the tenant column to itself) — affects 0 rows when RLS hides the row. */
export const touchRow = (table: string, tenantColumn: string, key: Row) =>
  sql`update ${sql.identifier(table)} set ${sql.identifier(tenantColumn)} = ${sql.identifier(tenantColumn)} where ${whereKey(key)}`;

export const moveRow = (table: string, tenantColumn: string, key: Row, toTenant: string) =>
  sql`update ${sql.identifier(table)} set ${sql.identifier(tenantColumn)} = ${toTenant} where ${whereKey(key)}`;

export const deleteRow = (table: string, key: Row) =>
  sql`delete from ${sql.identifier(table)} where ${whereKey(key)}`;

function one<T>(rows: T[], what: string): T {
  const [row] = rows;
  if (row === undefined) throw new Error(`${what} insert returned nothing`);
  return row;
}

/** Build one tenant's world as the owner, in one transaction, with typed Drizzle inserts. */
export async function createWorld(owner: Db, label: string, includeLedger = true): Promise<World> {
  const tag = uniqueTag();
  const slug = `iso-${label}-${tag}`;
  const domainHost = `${label}-${tag}.example.test`;
  return owner.transaction(async (tx) => {
    let tenantId = '';
    while (!tenantId) {
      const prefix = [...uniqueTag().slice(0, 4)].map(c => String.fromCharCode(65 + parseInt(c, 16))).join('');
      const [tenant] = await tx.insert(schema.tenants)
        .values({ slug, name: `Isolation ${label} ${tag}`, plan: 'institute', studentNoPrefix: prefix })
        .onConflictDoNothing({ target: schema.tenants.studentNoPrefix })
        .returning({ id: schema.tenants.id });
      tenantId = tenant?.id ?? '';
    }

    const domain = one(
      await tx
        .insert(schema.tenantDomains)
        .values({ tenantId, host: domainHost, verifiedAt: new Date(), isPrimary: true })
        .returning({ id: schema.tenantDomains.id }),
      'domain',
    );

    const user = (kind: 'staff' | 'student', phone: string, displayName: string) =>
      tx
        .insert(schema.tenantUsers)
        .values({ tenantId, kind, phone, displayName, passwordHash: 'test-hash' })
        .returning({ id: schema.tenantUsers.id })
        .then((rows) => one(rows, displayName));
    const staff = await user('staff', '+94770000001', 'Staff');
    const student = await user('student', '+94770000002', 'Student');
    const spare = await user('student', '+94770000003', 'Spare');

    const role = one(
      await tx
        .insert(schema.staffRoles)
        .values({ tenantId, userId: staff.id, role: 'owner' })
        .returning({ id: schema.staffRoles.id }),
      'staff role',
    );
    await tx.insert(schema.students).values({ tenantId, userId: student.id, studentNo: 'IS-0001' });

    const device = one(
      await tx
        .insert(schema.devices)
        .values({ tenantId, userId: student.id, tokenHash: hash('a'), label: 'Chrome on Android' })
        .returning({ id: schema.devices.id }),
      'device',
    );
    const session = one(
      await tx
        .insert(schema.sessions)
        .values({
          tenantId,
          userId: student.id,
          tokenHash: hash('b'),
          familyId: randomUUID(),
          deviceId: device.id,
          expiresAt: inOneHour(),
        })
        .returning({ id: schema.sessions.id }),
      'session',
    );

    const hall = one(
      await tx
        .insert(schema.halls)
        .values({ tenantId, name: 'Hall A', capacity: 120 })
        .returning({ id: schema.halls.id }),
      'hall',
    );
    const klass = one(
      await tx
        .insert(schema.classes)
        .values({
          tenantId,
          name: '2027 A/L Physics Theory',
          grade: '2027 A/L',
          medium: 'sinhala',
          teacherId: staff.id,
          hallId: hall.id,
          feeCents: 250_000,
          place: 'hall',
        })
        .returning({ id: schema.classes.id }),
      'class',
    );
    const schedule = one(
      await tx
        .insert(schema.classSchedules)
        .values({
          tenantId,
          classId: klass.id,
          weekday: 6,
          startTime: '08:00',
          durationMinutes: 120,
        })
        .returning({ id: schema.classSchedules.id }),
      'schedule',
    );
    const enrollment = one(
      await tx
        .insert(schema.enrollments)
        .values({ tenantId, classId: klass.id, studentId: student.id, fromMonth: '2026-09-01' })
        .returning({ id: schema.enrollments.id }),
      'enrollment',
    );

    const guardian = one(
      await tx
        .insert(schema.guardians)
        .values({
          tenantId,
          studentId: student.id,
          name: 'Guardian',
          relation: 'mother',
          phone: '+94770000066',
        })
        .returning({ id: schema.guardians.id }),
      'guardian',
    );
    await tx.insert(schema.tenantCounters).values({ tenantId, kind: 'student', value: 1 });
    const audit = one(
      await tx
        .insert(schema.auditLogs)
        .values({
          tenantId,
          actorKind: 'system',
          action: 'tenant.create',
          entity: 'tenant',
          entityId: tenantId,
        })
        .returning({ id: schema.auditLogs.id }),
      'audit log',
    );

    const otp = one(
      await tx
        .insert(schema.otpChallenges)
        .values({
          tenantId,
          phone: '+94770000002',
          userId: student.id,
          purpose: 'password_reset',
          codeHash: hash('e'),
          expiresAt: inOneHour(),
        })
        .returning({ id: schema.otpChallenges.id }),
      'otp challenge',
    );
    const ticket = one(
      await tx
        .insert(schema.authTickets)
        .values({
          tenantId,
          userId: staff.id,
          kind: 'two_step',
          tokenHash: hash('e'),
          codeHash: hash('e'),
          expiresAt: inOneHour(),
        })
        .returning({ id: schema.authTickets.id }),
      'auth ticket',
    );
    const invite = one(
      await tx
        .insert(schema.staffInvites)
        .values({
          tenantId,
          displayName: 'Invitee',
          phone: '+94770000007',
          role: 'cashier',
          tokenHash: hash('e'),
          invitedBy: staff.id,
          expiresAt: inOneHour(),
        })
        .returning({ id: schema.staffInvites.id }),
      'staff invite',
    );

    const importJob = one(
      await tx
        .insert(schema.importJobs)
        .values({ tenantId, createdBy: staff.id, options: { sendWelcomeSms: false }, input: [] })
        .returning({ id: schema.importJobs.id }),
      'import job',
    );

    const ledger = includeLedger
      ? await (async () => {
          await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
          const settings = one(
            await tx.insert(schema.tenantSettings).values({ tenantId }).returning(),
            'settings',
          );
          await tx
            .insert(schema.tenantIntegrations)
            .values({
              tenantId,
              kind: 'payhere',
              config: { enabled: false, mode: 'sandbox', merchantId: null, lastTest: null },
            });
          const spareEnrollment = one(
            await tx
              .insert(schema.enrollments)
              .values({
                tenantId,
                classId: klass.id,
                studentId: student.id,
                fromMonth: '2026-09-01',
              })
              .returning(),
            'spare enrolment',
          );
          const invoice = one(
            await tx
              .insert(schema.invoices)
              .values({
                tenantId,
                studentId: student.id,
                number: 'IS-I-26-09-IS-0001',
                month: '2026-09-01',
                dueOn: '2026-09-05',
                status: 'paid',
                paidCents: 250000,
              })
              .returning(),
            'invoice',
          );
          const line = one(
            await tx
              .insert(schema.invoiceLines)
              .values({
                tenantId,
                invoiceId: invoice.id,
                enrollmentId: enrollment.id,
                classId: klass.id,
                month: '2026-09-01',
                amountCents: 250000,
              })
              .returning(),
            'line',
          );
          const payment = one(
            await tx
              .insert(schema.payments)
              .values({
                tenantId,
                studentId: student.id,
                method: 'cash',
                amountCents: 250000,
                idempotencyKey: 'world-payment',
                receivedBy: staff.id,
              })
              .returning(),
            'payment',
          );
          const sparePayment = one(
            await tx
              .insert(schema.payments)
              .values({
                tenantId,
                studentId: student.id,
                method: 'cash',
                amountCents: 250000,
                idempotencyKey: 'spare-payment',
              })
              .returning(),
            'spare payment',
          );
          await tx
            .insert(schema.paymentAllocations)
            .values({
              tenantId,
              paymentId: payment.id,
              invoiceLineId: line.id,
              amountCents: 250000,
            });
          const receipt = one(
            await tx
              .insert(schema.receipts)
              .values({ tenantId, paymentId: payment.id, number: 'IS-R-26-00001' })
              .returning(),
            'receipt',
          );
          return {
            invoiceId: invoice.id,
            lineId: line.id,
            paymentId: payment.id,
            sparePaymentId: sparePayment.id,
            spareEnrollmentId: spareEnrollment.id,
            receiptId: receipt.id,
            settingsId: settings.id,
          };
        })()
      : {
          invoiceId: '',
          lineId: '',
          paymentId: '',
          sparePaymentId: '',
          spareEnrollmentId: '',
          receiptId: '',
          settingsId: '',
        };

    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    const card = includeLedger
      ? one(
          await tx
            .insert(schema.studentCards)
            .values({
              tenantId,
              studentId: student.id,
              code: 'ISOLATIONCARD',
              format: 'qr',
              source: 'issued',
              issuedBy: staff.id,
            })
            .returning(),
          'card',
        )
      : { id: '' };
    return {
      cardId: card.id,
      tag,
      tenantId,
      slug,
      domainHost,
      domainId: domain.id,
      staffUserId: staff.id,
      studentUserId: student.id,
      spareStudentUserId: spare.id,
      staffRoleId: role.id,
      deviceId: device.id,
      sessionId: session.id,
      hallId: hall.id,
      classId: klass.id,
      scheduleId: schedule.id,
      enrollmentId: enrollment.id,
      guardianId: guardian.id,
      auditLogId: audit.id,
      otpChallengeId: otp.id,
      authTicketId: ticket.id,
      staffInviteId: invite.id,
      importJobId: importJob.id,
      ...ledger,
    };
  });
}
