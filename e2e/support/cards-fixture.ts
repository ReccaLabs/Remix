import { createOwnerDb, schema, withTenant } from '../../packages/db/src';
import { DATABASE_URL } from './env';

/** DEV/TEST only: append the first invoice month for the student just created in the browser. */
export async function prepareCardMonths(studentId: string) {
  const url = new URL(DATABASE_URL);
  url.username = 'remix_owner';
  url.password = 'remix_owner_dev_password';
  const db = createOwnerDb(url.toString());
  try {
    const tenant = await db.query.tenants.findFirst({
      where: (t, { eq }) => eq(t.slug, 'kamalphysics'),
    });
    if (!tenant) throw new Error('Seed the dev tenants before the card journey');
    return await withTenant(db, tenant.id, async (tx) => {
      const student = await tx.query.students.findFirst({
        where: (s, { eq }) => eq(s.userId, studentId),
      });
      const enrollment = await tx.query.enrollments.findFirst({
        where: (e, { eq }) => eq(e.studentId, studentId),
      });
      if (!student || !enrollment)
        throw new Error('The browser must create and enrol the journey student');
      const klass = await tx.query.classes.findFirst({
        where: (c, { eq }) => eq(c.id, enrollment.classId),
      });
      if (!klass || !klass.feeCents) throw new Error('Use a class with a fee for the card journey');
      const month = enrollment.fromMonth;
      const [invoice] = await tx
        .insert(schema.invoices)
        .values({
          tenantId: tenant.id,
          studentId,
          number: `${tenant.studentNoPrefix}-I-${month.slice(2, 7)}-${student.studentNo}`,
          month,
          dueOn: `${month.slice(0, 7)}-05`,
        })
        .onConflictDoNothing()
        .returning();
      const current =
        invoice ??
        (await tx.query.invoices.findFirst({
          where: (i, { and, eq }) => and(eq(i.studentId, studentId), eq(i.month, month)),
        }));
      if (!current) throw new Error('Card journey invoice missing');
      await tx
        .insert(schema.invoiceLines)
        .values({
          tenantId: tenant.id,
          invoiceId: current.id,
          enrollmentId: enrollment.id,
          classId: klass.id,
          month,
          amountCents: klass.feeCents,
        })
        .onConflictDoNothing();
      return {
        studentNo: student.studentNo,
        totalCents: klass.feeCents,
        className: klass.name,
        month,
      };
    });
  } finally {
    await db.$client.end();
  }
}
