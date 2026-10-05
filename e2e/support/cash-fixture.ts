import { createOwnerDb, schema, withTenant } from '../../packages/db/src';
import { DATABASE_URL } from './env';

/** DEV/TEST only: append two invoice months for an existing seeded enrolment; never reset data. */
export async function prepareCashFixture(project: string) {
  const url = new URL(DATABASE_URL);
  url.username = 'remix_owner'; url.password = 'remix_owner_dev_password';
  const db = createOwnerDb(url.toString());
  try {
    const tenant = await db.query.tenants.findFirst({ where: (t, { eq }) => eq(t.slug, 'kamalphysics') });
    if (!tenant) throw new Error('Seed the development tenants before this journey');
    return await withTenant(db, tenant.id, async tx => {
      const start = project === 'mobile-chrome' ? 1550 : 1530;
      for (let n = start; n < start + 15; n++) {
        const phone = `+9471${String(n).padStart(7, '0')}`;
        const user = await tx.query.tenantUsers.findFirst({ where: (u, { and, eq }) => and(eq(u.phone, phone), eq(u.kind, 'student'), eq(u.status, 'active')) });
        if (!user) continue;
        const student = await tx.query.students.findFirst({ where: (s, { eq }) => eq(s.userId, user.id) });
        if (!student || student.archivedAt) continue;
        const enrollments = await tx.query.enrollments.findMany({ where: (e, { and, eq, isNull }) => and(eq(e.studentId, user.id), isNull(e.toMonth)) });
        for (const enrollment of enrollments) {
          const klass = await tx.query.classes.findFirst({ where: (c, { eq }) => eq(c.id, enrollment.classId) });
          const amount = enrollment.feeOverrideCents ?? klass?.feeCents ?? 0;
          if (!klass || amount <= 0) continue;
          const monthValues = ['2026-10-01', '2026-11-01'];
          if (enrollment.fromMonth > monthValues[0]!) continue;
          const lineIds: string[] = [];
          for (const month of monthValues) {
            await tx.insert(schema.invoices).values({ tenantId: tenant.id, studentId: user.id,
              number: `${tenant.studentNoPrefix}-I-${month.slice(2, 7)}-${student.studentNo}`, month, dueOn: `${month.slice(0, 7)}-05` }).onConflictDoNothing();
            const invoice = await tx.query.invoices.findFirst({ where: (i, { and, eq }) => and(eq(i.studentId, user.id), eq(i.month, month)) });
            if (!invoice) throw new Error('Journey invoice missing');
            await tx.insert(schema.invoiceLines).values({ tenantId: tenant.id, invoiceId: invoice.id, enrollmentId: enrollment.id,
              classId: klass.id, month, amountCents: amount }).onConflictDoNothing();
            const line = await tx.query.invoiceLines.findFirst({ where: (l, { and, eq }) => and(eq(l.enrollmentId, enrollment.id), eq(l.month, month)) });
            if (!line) throw new Error('Journey line missing');
            lineIds.push(line.id);
          }
          return { studentId: user.id, name: user.displayName, phone, lineIds, className: klass.name, totalCents: amount * 2 };
        }
      }
      throw new Error('No active seeded student enrolment for the cash journey');
    });
  } finally { await db.$client.end(); }
}
