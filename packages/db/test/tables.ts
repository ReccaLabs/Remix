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
 * - read: SELECT within the tenant only (rows managed by the owner/platform).
 * - append: SELECT + INSERT within the tenant (audit trail).
 * - full: SELECT, INSERT, UPDATE, DELETE within the tenant.
 */
export type Access = 'root' | 'read' | 'append' | 'full';

export const APP_PRIVILEGES: Record<Access, readonly string[]> = {
  root: ['SELECT'],
  read: ['SELECT'],
  append: ['INSERT', 'SELECT'],
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
  classId: string;
  scheduleId: string;
  enrollmentId: string;
  auditLogId: string;
}

type Row = Record<string, unknown>;

export interface TableSpec {
  access: Access;
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

export const TABLES = {
  tenants: {
    access: 'root',
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
  classes: {
    access: 'full',
    tenantColumn: 'tenant_id',
    key: (w) => ({ id: w.classId }),
    fresh: freshClass,
    crossTenantRefs: {
      teacher: (home, other) => ({ ...freshClass(home), teacher_id: other.staffUserId }),
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
export async function createWorld(owner: Db, label: string): Promise<World> {
  const tag = uniqueTag();
  const slug = `iso-${label}-${tag}`;
  const domainHost = `${label}-${tag}.example.test`;
  return owner.transaction(async (tx) => {
    const { id: tenantId } = one(
      await tx
        .insert(schema.tenants)
        .values({
          slug,
          name: `Isolation ${label} ${tag}`,
          plan: 'institute',
          studentNoPrefix: 'IS',
        })
        .returning({ id: schema.tenants.id }),
      'tenant',
    );

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

    const klass = one(
      await tx
        .insert(schema.classes)
        .values({
          tenantId,
          name: '2027 A/L Physics Theory',
          grade: '2027 A/L',
          medium: 'sinhala',
          teacherId: staff.id,
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

    return {
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
      classId: klass.id,
      scheduleId: schedule.id,
      enrollmentId: enrollment.id,
      auditLogId: audit.id,
    };
  });
}
