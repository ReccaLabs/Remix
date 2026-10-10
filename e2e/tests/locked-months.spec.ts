import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { KAMAL, PASSWORD } from '../support/accounts';
import { loginStaffCached, loginStudentOnAnyDevice } from '../support/auth';
import { expectNoSeriousA11yViolations } from '../support/axe';
import { tenantUrl } from '../support/env';
import { colomboMonth, monthUnlocked, pageApi, prepareStudents, reversePaymentsFor } from '../support/money';

/**
 * J-05, the part Phase 3 can prove (docs/plan/04-quality.md, ADR 0008 section 3): an unpaid student
 * sees the months as unpaid, the unlock rule says "locked" until the allocations cover the line,
 * paying one month unlocks exactly that month, a reversal locks it again, and the API refuses the
 * student every staff-only money action. Playback tokens and Zoom joins do not exist until
 * Phases 4-5; their half of J-05 is the fixme below.
 */
test('J-05 FEE rule 2: unpaid months are locked, paying one unlocks only that month, a student cannot self-serve', async ({ browser, page }, info) => {
  const mobile = info.project.name === 'mobile-chrome';
  const months = [colomboMonth(0), colomboMonth(1)];
  const [student] = await prepareStudents({ from: mobile ? 1790 : 1760, count: 1, months });
  if (!student) throw new Error('No journey student');
  const [month0, month1] = months as [string, string];
  const studentContext = await browser.newContext({ ...info.project.use, extraHTTPHeaders: { 'x-forwarded-for': `10.30.0.${mobile ? 2 : 1}` } });
  const studentPage = await studentContext.newPage();
  try {
    await loginStaffCached(page, 'kamalphysics', KAMAL.email, PASSWORD, KAMAL.seedPhone);
    // A failed earlier attempt may have left a payment on these months: undo it through the public API.
    await reversePaymentsFor(page, student.studentId, student.lineIds, 'J-05 journey reset');
    expect(await monthUnlocked(student.studentId, student.classId, month0)).toBe(false);
    expect(await monthUnlocked(student.studentId, student.classId, month1)).toBe(false);

    // The student sees both months as unpaid, in words, and nothing to download yet.
    await loginStudentOnAnyDevice(studentPage, 'kamalphysics', student.phone.replace('+94', '0'), PASSWORD);
    await studentPage.goto(tenantUrl('kamalphysics', '/app/pay'));
    const open = studentPage.getByRole('region', { name: 'Open months' });
    await expect(open.getByRole('listitem')).toHaveCount(2);
    await expect(open.getByText(/^(Unpaid|Overdue)$/)).toHaveCount(2);
    await expect(open.getByText(student.className).first()).toBeVisible();
    await expectNoSeriousA11yViolations(studentPage);
    const mine = await pageApi<{ openLines: { id: string; paid: boolean }[]; payments: unknown[] }>(studentPage, 'GET', '/api/v1/me/fees');
    expect(mine.status).toBe(200);
    expect(mine.body.openLines.map((l) => l.id).sort()).toEqual([...student.lineIds].sort());
    expect(mine.body.openLines.every((l) => !l.paid)).toBe(true);

    // The API refuses a student every staff-only money action (deny by default).
    const refusals = [
      await pageApi(studentPage, 'POST', '/api/v1/admin/payments/cash', { studentId: student.studentId, lineIds: student.lineIds, cashReceivedCents: student.feeCents * 2, idempotencyKey: randomUUID() }),
      await pageApi(studentPage, 'POST', '/api/v1/admin/payments/manual', { studentId: student.studentId, lineIds: student.lineIds, kind: 'other', reference: 'J05-REF', receivedOn: month0, idempotencyKey: randomUUID() }),
      await pageApi(studentPage, 'POST', `/api/v1/admin/slips/${randomUUID()}/approve`, {}),
      await pageApi(studentPage, 'GET', '/api/v1/admin/invoices'),
      await pageApi(studentPage, 'GET', `/api/v1/admin/students/${student.studentId}/fees`),
      await pageApi(studentPage, 'POST', `/api/v1/admin/payments/${randomUUID()}/reverse`, { reason: 'Not allowed' }),
    ];
    expect(refusals.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403]);
    // Another student's receipt is not reachable either.
    const payments = await pageApi<{ items: { studentId: string; receiptId: string | null }[] }>(page, 'GET', '/api/v1/admin/payments?pageSize=100');
    const other = payments.body.items.find((p) => p.receiptId && p.studentId !== student.studentId);
    expect(other, 'the dev seed has a payment with a receipt').toBeTruthy();
    expect([403, 404]).toContain((await pageApi(studentPage, 'GET', `/api/v1/receipts/${other!.receiptId}/pdf`)).status);

    // The cashier pays month 1 only: exactly that month unlocks, the other stays locked.
    const paid = await pageApi<{ id: string }>(page, 'POST', '/api/v1/admin/payments/cash', { studentId: student.studentId, lineIds: [student.lineIds[0]], cashReceivedCents: student.feeCents, idempotencyKey: randomUUID() });
    expect(paid.status).toBe(200);
    expect(await monthUnlocked(student.studentId, student.classId, month0)).toBe(true);
    expect(await monthUnlocked(student.studentId, student.classId, month1)).toBe(false);
    await studentPage.reload();
    await expect(open.getByRole('listitem')).toHaveCount(1);
    await expect(open.getByText(/^(Unpaid|Overdue)$/)).toHaveCount(1);
    await expect(studentPage.getByRole('heading', { name: 'Payment history' })).toBeVisible();

    // Reversing the payment locks the month again.
    expect(await reversePaymentsFor(page, student.studentId, student.lineIds, 'J-05 journey cleanup')).toBe(1);
    expect(await monthUnlocked(student.studentId, student.classId, month0)).toBe(false);
    await studentPage.reload();
    await expect(open.getByRole('listitem')).toHaveCount(2);
  } finally {
    // Best effort: leave the months unpaid for the next run whatever happened above.
    await reversePaymentsFor(page, student.studentId, student.lineIds, 'J-05 journey cleanup').catch(() => 0);
    await studentContext.close();
  }
});

// Phases 4-5 (LES-07/08 playback tokens, LIV zoom join): an unpaid student must also get a 403 for a
// video playback token and a Zoom join URL. Neither endpoint exists yet, so there is nothing to call;
// enable this when they land and assert 403 for the locked month and 200 after payment.
test.fixme('J-05 (Phases 4-5): unpaid student cannot fetch a video playback token or a Zoom join URL', async () => {
  // Intentionally empty until Phase 4 (lessons, playback tokens) and Phase 5 (live classes) ship.
});
