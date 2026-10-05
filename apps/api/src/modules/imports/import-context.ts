import { eq, inArray } from 'drizzle-orm';
import { normalizeStudentNo, studentNoNormalForm, schema, type Tx } from '@remix/db';
import type { ImportRow } from '@remix/types';
import {
  classKey,
  phonesOf,
  studentNosOf,
  type ClassMatch,
  type ValidationContext,
} from './row-validator';

const { tenantUsers, students, classes } = schema;

/**
 * Load what the validator needs to know about the tenant's data: phones and student numbers that
 * are taken (only for those in the file) and every class by name. Runs inside `withTenant`, so
 * RLS limits all of it to the caller's tenant.
 */
export async function loadValidationContext(
  tx: Tx,
  rows: readonly ImportRow[],
): Promise<ValidationContext> {
  const phones = new Map<string, string | null>();
  const wantedPhones = phonesOf(rows);
  if (wantedPhones.length > 0) {
    const taken = await tx
      .select({ phone: tenantUsers.phone, studentNo: students.studentNo })
      .from(tenantUsers)
      .leftJoin(students, eq(students.userId, tenantUsers.id))
      .where(inArray(tenantUsers.phone, wantedPhones));
    for (const row of taken) if (row.phone) phones.set(row.phone, row.studentNo);
  }

  const wantedNos = studentNosOf(rows);
  const studentNos = new Set<string>();
  if (wantedNos.length > 0) {
    const taken = await tx
      .select({ studentNo: students.studentNo })
      .from(students)
      .where(inArray(studentNoNormalForm(students.studentNo), wantedNos));
    for (const row of taken) studentNos.add(normalizeStudentNo(row.studentNo));
  }

  const classMap = new Map<string, ClassMatch>();
  for (const row of await tx
    .select({ id: classes.id, name: classes.name, archivedAt: classes.archivedAt })
    .from(classes)) {
    const key = classKey(row.name);
    const archived = row.archivedAt !== null;
    const entry = classMap.get(key);
    // An archived class never shadows an active one of the same name.
    if (!entry) classMap.set(key, { ids: [row.id], archived });
    else if (entry.archived && !archived) classMap.set(key, { ids: [row.id], archived: false });
    else if (!entry.archived && !archived) entry.ids.push(row.id);
  }

  return { phones, studentNos, classes: classMap };
}
