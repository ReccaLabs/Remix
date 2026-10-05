import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { students } from '../src/schema';
import { normalizeStudentNo, studentNoNormalForm } from '../src/student-numbers';
import { withTenant } from '../src/tenant';
import { connectAll, expectPgError } from './support';
import { createWorld, type World } from './tables';

const db = connectAll();
let a: World;
let b: World;
beforeAll(async () => {
  [a, b] = await Promise.all([
    createWorld(db.owner, 'normal-a'),
    createWorld(db.owner, 'normal-b'),
  ]);
});
describe('STU-07 normalised student number identities', () => {
  it('has the required SQL normal form and rejects duplicates without changing display spelling', async () => {
    const spelling = ' old - 77 ';
    await withTenant(db.owner, a.tenantId, (tx) =>
      tx.update(students).set({ studentNo: spelling }).where(eq(students.userId, a.studentUserId)),
    );
    const rows = await withTenant(db.app, a.tenantId, (tx) =>
      tx
        .select({ number: students.studentNo, normal: studentNoNormalForm(students.studentNo) })
        .from(students)
        .where(eq(students.userId, a.studentUserId)),
    );
    expect(rows[0]).toEqual({ number: spelling, normal: normalizeStudentNo(spelling) });
    for (const number of ['OLD-77', 'oLd -77', '\tOLD-77\r\n']) {
      await expectPgError(
        withTenant(db.owner, a.tenantId, (tx) =>
          tx
            .insert(students)
            .values({ tenantId: a.tenantId, userId: a.spareStudentUserId, studentNo: number }),
        ),
        '23505',
      );
    }
    // The reservation is per tenant, including archived students.
    await withTenant(db.owner, b.tenantId, (tx) =>
      tx.update(students).set({ studentNo: 'OLD-77' }).where(eq(students.userId, b.studentUserId)),
    );
    await withTenant(db.owner, a.tenantId, (tx) =>
      tx
        .update(students)
        .set({ archivedAt: new Date() })
        .where(eq(students.userId, a.studentUserId)),
    );
    await expectPgError(
      withTenant(db.owner, a.tenantId, (tx) =>
        tx
          .insert(students)
          .values({ tenantId: a.tenantId, userId: a.spareStudentUserId, studentNo: 'OLD-77' }),
      ),
      '23505',
    );
    const index = await db.superuser.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where indexname = 'students_tenant_student_no_normal_key'`,
    );
    expect(index.rows[0]?.indexdef).toContain('upper(regexp_replace(student_no');
  });
});
