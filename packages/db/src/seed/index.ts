import { inArray } from 'drizzle-orm';
import type { Db, Tx } from '../client';
import { allocateNumbers, formatStudentNo } from '../counters';
import {
  auditLogs,
  classes,
  classSchedules,
  enrollments,
  staffRoles,
  students,
  tenantCounters,
  tenantDomains,
  tenants,
  tenantUsers,
} from '../schema';
import { withTenant } from '../tenant';
import { FIRST_NAMES, LAST_NAMES, SCHOOLS, SEED_TENANTS, type SeedTenant } from './data';
import { createRng, type Rng } from './random';

const RNG_SEED = 20_261_002;
const CHUNK = 500;
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

  // Classes and weekly schedules.
  const classRows = await tx
    .insert(classes)
    .values(
      spec.classes.map((c) => ({
        tenantId,
        name: c.name,
        grade: c.grade,
        medium: c.medium,
        teacherId: staffIds[c.teacher] ?? null,
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
  await tx.insert(tenantCounters).values({ tenantId, kind: 'student', value: spec.counterStart });
  const block = await withTenant(tx, tenantId, (scoped) =>
    allocateNumbers(scoped, 'student', spec.students),
  );

  const alYears = [...new Set(spec.classes.map((c) => c.alYear))];
  const people = Array.from({ length: spec.students }, (_, i) => {
    const no = block.first + i;
    const name = spec.namedStudents[no] ?? `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    return {
      no,
      studentNo: formatStudentNo(spec.studentNoPrefix, no),
      phone: `+94${spec.phoneBase}${String(no).padStart(7, '0')}`,
      name,
      alYear: rng.pick(alYears),
      school: rng.pick(SCHOOLS),
      locale: rng.chance(0.25) ? ('si' as const) : ('en' as const),
      disabled: rng.chance(0.01),
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
          passwordHash,
          locale: p.locale,
          status: p.disabled ? ('disabled' as const) : ('active' as const),
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
      })),
    ),
  );

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
