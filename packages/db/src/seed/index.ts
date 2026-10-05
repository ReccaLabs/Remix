import { createHash, randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { TWO_STEP_ROLES, type StaffRole } from '@remix/types';
import type { Db, Tx } from '../client';
import { allocateNumbers, formatStudentNo } from '../counters';
import {
  auditLogs,
  classes,
  halls,
  classSchedules,
  devices,
  enrollments,
  guardians,
  staffInvites,
  staffRoles,
  students,
  studentCards,
  tenantCounters,
  tenantDomains,
  tenants,
  tenantUsers,
} from '../schema';
import { withTenant } from '../tenant';
import { FIRST_NAMES, LAST_NAMES, SCHOOLS, SEED_TENANTS, type SeedTenant } from './data';
import { createRng, type Rng } from './random';
import { seedFees } from './fees';

const RNG_SEED = 20_261_002;

/**
 * Seeded staff who need the SMS two-step (owner/admin/cashier) get one "trusted computer" whose
 * trust cookie value is derivable from the tenant and phone, so E2E journeys and developers can
 * sign in without an SMS: set `remix_trust=<devTrustToken(slug, phone)>` on the tenant host.
 * DEV SEED ONLY — the seed refuses remote databases, and these accounts exist only in dev and CI.
 * e2e/support/auth.ts derives the same value.
 */
export function devTrustToken(slug: string, phone: string): string {
  return createHash('sha256').update(`remix-dev-trust|${slug}|${phone}`).digest('base64url');
}
const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');
/** Long enough that a local dev database seeded once keeps working (production trust: 30 days). */
const DEV_TRUST_DAYS = 365;
const twoStepRoles: readonly StaffRole[] = TWO_STEP_ROLES;
const CHUNK = 500;
const GUARDIAN_NAMES = ['Sunethra', 'Nimal', 'Kumari', 'Ranjith', 'Malini', 'Sarath'] as const;
/** Billing months the seeded enrolments start in (first of the month). */
const START_MONTHS = [
  '2026-01-01',
  '2026-02-01',
  '2026-03-01',
  '2026-04-01',
  '2026-05-01',
  '2026-06-01',
  '2026-07-01',
  '2026-08-01',
  '2026-09-01',
] as const;

export interface SeedSummary {
  slug: string;
  tenantId: string;
  staff: number;
  students: number;
  classes: number;
  enrollments: number;
}

async function insertChunked<T>(rows: readonly T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await insert(rows.slice(i, i + CHUNK));
}

/**
 * Dev seed (04-quality §4.2). Reset-first: deletes the seed tenants (cascading to all their rows)
 * and recreates them in one owner transaction, so running it twice gives the same data. Ids and
 * timestamps come from Postgres; everything else is derived from a fixed PRNG seed. Other
 * tenants (e.g. made with tenant:create) are left alone.
 */
export async function seed(owner: Db, passwordHash: string): Promise<SeedSummary[]> {
  const rng = createRng(RNG_SEED);
  return owner.transaction(async (tx) => {
    // DEV reset only: cards deliberately prevent parent deletion and the app has no DELETE.
    // Remove this seed's card rows under their tenant policy before recreating seed tenants.
    const previous = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(
        inArray(
          tenants.slug,
          SEED_TENANTS.map((t) => t.slug),
        ),
      );
    for (const tenant of previous)
      await withTenant(tx, tenant.id, (scoped) =>
        scoped.delete(studentCards).where(eq(studentCards.tenantId, tenant.id)),
      );
    await tx.delete(tenants).where(
      inArray(
        tenants.slug,
        SEED_TENANTS.map((t) => t.slug),
      ),
    );
    const summaries: SeedSummary[] = [];
    for (const spec of SEED_TENANTS) summaries.push(await seedTenant(tx, spec, passwordHash, rng));
    return summaries;
  });
}

async function seedTenant(
  tx: Tx,
  spec: SeedTenant,
  passwordHash: string,
  rng: Rng,
): Promise<SeedSummary> {
  const [tenant] = await tx
    .insert(tenants)
    .values({
      slug: spec.slug,
      name: spec.name,
      plan: spec.plan,
      status: spec.status,
      studentNoPrefix: spec.studentNoPrefix,
    })
    .returning({ id: tenants.id });
  if (!tenant) throw new Error(`seed: tenant ${spec.slug} not created`);
  const tenantId = tenant.id;

  if (spec.domains.length > 0) {
    await tx.insert(tenantDomains).values(
      spec.domains.map((d) => ({
        tenantId,
        host: d.host,
        isPrimary: d.primary,
        verifiedAt: d.verified ? new Date('2026-01-15T04:30:00Z') : null,
      })),
    );
  }

  // Staff and their roles.
  const staff = await tx
    .insert(tenantUsers)
    .values(
      spec.staff.map((s) => ({
        tenantId,
        kind: 'staff' as const,
        phone: s.phone,
        email: s.email ?? null,
        displayName: s.name,
        passwordHash,
      })),
    )
    .returning({ id: tenantUsers.id, phone: tenantUsers.phone });
  const staffIds = spec.staff.map((s) => {
    const row = staff.find((r) => r.phone === s.phone);
    if (!row) throw new Error(`seed: staff ${s.name} not created`);
    return row.id;
  });
  await tx
    .insert(staffRoles)
    .values(
      spec.staff.flatMap((s, i) =>
        s.roles.map((role) => ({ tenantId, userId: staffIds[i] ?? '', role })),
      ),
    );

  const trustedUntil = new Date(Date.now() + DEV_TRUST_DAYS * 24 * 60 * 60 * 1000);
  const trusted = spec.staff.flatMap((s, i) =>
    s.roles.some((role) => twoStepRoles.includes(role))
      ? [
          {
            tenantId,
            userId: staffIds[i] ?? '',
            tokenHash: sha256Hex(randomBytes(32).toString('base64url')),
            label: 'Seeded dev computer',
            trustTokenHash: sha256Hex(devTrustToken(spec.slug, s.phone)),
            trustedUntil,
          },
        ]
      : [],
  );
  if (trusted.length > 0) await tx.insert(devices).values(trusted);

  // Halls (CLS-05), then classes and weekly schedules.
  const hallRows = spec.halls.length
    ? await tx
        .insert(halls)
        .values(spec.halls.map((h) => ({ tenantId, name: h.name, capacity: h.capacity })))
        .returning({ id: halls.id, name: halls.name })
    : [];
  const hallIds = spec.halls.map((h) => {
    const row = hallRows.find((r) => r.name === h.name);
    if (!row) throw new Error(`seed: hall ${h.name} not created`);
    return row.id;
  });
  const classRows = await tx
    .insert(classes)
    .values(
      spec.classes.map((c) => ({
        tenantId,
        name: c.name,
        grade: c.grade,
        medium: c.medium,
        teacherId: staffIds[c.teacher] ?? null,
        hallId: c.hall === undefined ? null : (hallIds[c.hall] ?? null),
        feeCents: c.feeCents,
        place: c.place,
        startsOn: c.startsOn,
      })),
    )
    .returning({ id: classes.id, name: classes.name });
  const classIds = spec.classes.map((c) => {
    const row = classRows.find((r) => r.name === c.name);
    if (!row) throw new Error(`seed: class ${c.name} not created`);
    return row.id;
  });
  // STF-02 — teachers limited to some classes.
  for (const [i, s] of spec.staff.entries()) {
    if (!s.classScope) continue;
    await tx
      .update(staffRoles)
      .set({ classScope: s.classScope.map((c) => classIds[c] ?? '') })
      .where(and(eq(staffRoles.userId, staffIds[i] ?? ''), eq(staffRoles.role, 'teacher')));
  }
  await tx.insert(classSchedules).values(
    spec.classes.flatMap((c, i) =>
      c.schedules.map(([weekday, startTime, durationMinutes]) => ({
        tenantId,
        classId: classIds[i] ?? '',
        weekday,
        startTime,
        durationMinutes,
      })),
    ),
  );

  // Student numbers come from the tenant counter, exactly as the API allocates them (ADR 0007).
  await tx
    .insert(tenantCounters)
    .values({ tenantId, kind: 'student', period: '2026', value: spec.counterStart });
  const block = await withTenant(tx, tenantId, (scoped) =>
    allocateNumbers(scoped, 'student', spec.students, '2026'),
  );

  const alYears = [...new Set(spec.classes.map((c) => c.alYear))];
  const people = Array.from({ length: spec.students }, (_, i) => {
    const invited = i >= spec.students - spec.invitedStudents;
    const no = block.first + i;
    const name = spec.namedStudents[no] ?? `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    const alYear = rng.pick(alYears);
    return {
      no,
      studentNo: formatStudentNo(spec.studentNoPrefix, 2026, no),
      phone: `+94${spec.phoneBase}${String(no).padStart(7, '0')}`,
      alYear,
      name,
      school: rng.pick(SCHOOLS),
      locale: rng.chance(0.25) ? ('si' as const) : ('en' as const),
      invited,
      // Always draw, so the stream (and the e2e-visible enrolments) stays stable.
      disabled: rng.chance(0.01) && !invited,
      // Grade 11 students (no A/L year) are minors.
      under18: alYear === null,
    };
  });

  const userIdByPhone = new Map<string, string>();
  await insertChunked(people, async (chunk) => {
    const rows = await tx
      .insert(tenantUsers)
      .values(
        chunk.map((p) => ({
          tenantId,
          kind: 'student' as const,
          phone: p.phone,
          displayName: p.name,
          passwordHash: p.invited ? null : passwordHash,
          locale: p.locale,
          status: p.invited
            ? ('invited' as const)
            : p.disabled
              ? ('disabled' as const)
              : ('active' as const),
        })),
      )
      .returning({ id: tenantUsers.id, phone: tenantUsers.phone });
    for (const r of rows) if (r.phone) userIdByPhone.set(r.phone, r.id);
  });
  const userId = (phone: string) => {
    const id = userIdByPhone.get(phone);
    if (!id) throw new Error(`seed: student ${phone} not created`);
    return id;
  };

  await insertChunked(people, (chunk) =>
    tx.insert(students).values(
      chunk.map((p) => ({
        tenantId,
        userId: userId(p.phone),
        studentNo: p.studentNo,
        school: p.school,
        alYear: p.alYear,
        medium: spec.classes.find((c) => c.alYear === p.alYear)?.medium ?? null,
        under18: p.under18,
        ...(p.under18
          ? {
              consentGivenBy: 'Parent (paper form)',
              consentMethod: 'paper_form' as const,
              consentRecordedAt: new Date('2026-02-01T05:00:00Z'),
            }
          : {}),
      })),
    ),
  );

  // PAR-01 — every student has a mother on file; every 4th also a father who opts out of SMS.
  const guardianRows = people.flatMap((p) => {
    const studentId = userId(p.phone);
    const first = GUARDIAN_NAMES[p.no % GUARDIAN_NAMES.length] ?? 'Parent';
    const lastName = p.name.split(' ').slice(-1)[0] ?? p.name;
    const rows: (typeof guardians.$inferInsert)[] = [
      {
        tenantId,
        studentId,
        name: `${first} ${lastName}`,
        relation: 'mother' as const,
        phone: `+94${spec.phoneBase === '71' ? '72' : '73'}${String(p.no).padStart(7, '1')}`,
        smsOptIn: true,
      },
    ];
    if (p.no % 4 === 0) {
      rows.push({
        tenantId,
        studentId,
        name: `Nimal ${lastName}`,
        relation: 'father' as const,
        phone: `+94${spec.phoneBase === '71' ? '74' : '76'}${String(p.no).padStart(7, '2')}`,
        smsOptIn: false,
      });
    }
    return rows;
  });
  await insertChunked(guardianRows, (chunk) => tx.insert(guardians).values(chunk));

  if (spec.pendingInvite) {
    await tx.insert(staffInvites).values({
      tenantId,
      displayName: spec.pendingInvite.name,
      phone: spec.pendingInvite.phone,
      role: spec.pendingInvite.role,
      classScope: [classIds[4] ?? ''],
      // Dev-only token; the raw value is never needed (only the hash is stored).
      tokenHash: createHash('sha256').update(`seed-invite-${spec.slug}`).digest('hex'),
      invitedBy: staffIds[0] ?? '',
      expiresAt: new Date(Date.now() + 72 * 3_600_000),
    });
  }

  // Each student takes one or more classes of their year group, from a deterministic month.
  const enrollmentRows = people.flatMap((p) => {
    const options = spec.classes.flatMap((c, i) => (c.alYear === p.alYear ? [i] : []));
    const taken = options.filter((_, k) => k === 0 || rng.chance(0.55));
    const fromMonth = rng.pick(START_MONTHS);
    return taken.map((i) => {
      const discounted = rng.chance(0.05);
      const fee = spec.classes[i]?.feeCents ?? 0;
      return {
        tenantId,
        classId: classIds[i] ?? '',
        studentId: userId(p.phone),
        fromMonth,
        feeOverrideCents: discounted ? Math.round(fee / 2) : null,
        reason: discounted ? 'Sibling discount' : null,
      };
    });
  });
  await insertChunked(enrollmentRows, (chunk) => tx.insert(enrollments).values(chunk));

  await tx.insert(auditLogs).values({
    tenantId,
    actorKind: 'system',
    action: 'tenant.seed',
    entity: 'tenant',
    entityId: tenantId,
    after: { slug: spec.slug, students: spec.students },
  });

  await withTenant(tx, tenantId, (scoped) =>
    seedFees(scoped, tenantId, spec.studentNoPrefix, staffIds[0] ?? ''),
  );
  return {
    slug: spec.slug,
    tenantId,
    staff: spec.staff.length,
    students: spec.students,
    classes: spec.classes.length,
    enrollments: enrollmentRows.length,
  };
}

export { SEED_PASSWORD, SEED_TENANTS } from './data';
