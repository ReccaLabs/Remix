import { expect, test, type Page } from '@playwright/test';
import { KAMAL, PASSWORD } from '../support/accounts';
import { loginStaff, logout, submitStudentLogin } from '../support/auth';
import { prepareCashFixture } from '../support/cash-fixture';
import { expectNoSeriousA11yViolations } from '../support/axe';
import { tenantUrl } from '../support/env';

async function viewportChecks(page: Page, screenshot: (name: string) => string) {
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: screenshot(`fees-${width}.png`), fullPage: true });
  }
  await expectNoSeriousA11yViolations(page);
}

test('FEE-07/FEE-10: cashier collects two months → prints receipt → student sees payment', async ({ page, browser }, info) => {
  const fixture = await prepareCashFixture(info.project.name);
  const studentContext = await browser.newContext({ ...info.project.use, extraHTTPHeaders: { 'x-forwarded-for': `10.27.0.${info.project.name === 'chromium' ? 1 : 2}` } });
  const ownerContext = await browser.newContext({ ...info.project.use, extraHTTPHeaders: { 'x-forwarded-for': `10.28.0.${info.project.name === 'chromium' ? 1 : 2}` } });
  const ownerPage = await ownerContext.newPage();
  let paymentId: string | undefined;
  let receiptPage: Page | undefined;
  let studentPage: Page | undefined;
  try {
    await loginStaff(ownerPage, 'kamalphysics', KAMAL.email, PASSWORD, KAMAL.seedPhone);
    // A failed earlier run may have collected these fixture months. Restore only those
    // allocations through the public reversal API, retaining all audit history.
    const restored = await ownerPage.evaluate(async ({ studentId, lineIds }) => {
      const res = await fetch(`/api/v1/admin/students/${studentId}/fees`);
      if (!res.ok) return res.status;
      const fees = await res.json() as { payments: { id: string; reversesPaymentId: string | null; reversedByPaymentId: string | null; lines: { lineId: string }[] }[] };
      for (const payment of fees.payments) {
        if (payment.reversesPaymentId || payment.reversedByPaymentId || !payment.lines.some(line => lineIds.includes(line.lineId))) continue;
        const reversed = await fetch(`/api/v1/admin/payments/${payment.id}/reverse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Restore cash journey fixture months' }) });
        if (!reversed.ok) return reversed.status;
      }
      return 200;
    }, fixture);
    expect(restored).toBe(200);
    await loginStaff(page, 'kamalphysics', '+94770001182', PASSWORD, '+94770001182');
    await page.goto(tenantUrl('kamalphysics', '/admin/fees?tab=cash'));
    const search = page.getByLabel('Search student');
    await expect(search).toBeFocused();
    await search.pressSequentially(fixture.phone); await search.press('Enter');
    await expect(page.getByRole('button', { name: /^Choose / })).toBeVisible();
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
    const first = page.locator(`input[type=checkbox][value="${fixture.lineIds[0]}"]`);
    await expect(first).toBeFocused();
    await page.keyboard.press('Space'); await page.keyboard.press('Tab'); await page.keyboard.press('Space'); await page.keyboard.press('Tab');
    const received = page.getByLabel('Cash received (LKR)'); await expect(received).toBeFocused();
    await received.pressSequentially(((fixture.totalCents + 10000) / 100).toFixed(2));
    await viewportChecks(page, name => info.outputPath(`cash-${name}`));
    const popup = page.waitForEvent('popup');
    const response = page.waitForResponse(res => res.url().endsWith('/api/v1/admin/payments/cash') && res.request().method() === 'POST');
    await received.press('Enter');
    receiptPage = await popup;
    const recorded = await response; expect(recorded.status()).toBe(200);
    const payment = await recorded.json() as { id: string; receiptId: string; receiptNumber: string; lines: { month: string }[]; amountCents: number };
    paymentId = payment.id;
    expect(payment.lines.map(l => l.month)).toEqual(['2026-10-01', '2026-11-01']);
    expect(payment.amountCents).toBe(fixture.totalCents);
    await expect(receiptPage).toHaveURL(new RegExp(`/admin/receipts/${payment.receiptId}/print$`));
    await expect(receiptPage.getByRole('heading', { name: `Receipt ${payment.receiptNumber}` })).toBeVisible();
    await expect(receiptPage.locator('dd').filter({ hasText: fixture.name })).toBeVisible();
    await expect(receiptPage.getByText('LKR 100.00', { exact: true })).toBeVisible();
    await expect(search).toHaveValue(''); await expect(search).toBeFocused();
    studentPage = await studentContext.newPage();
    await submitStudentLogin(studentPage, 'kamalphysics', fixture.phone, PASSWORD);
    await expect.poll(async () => studentPage!.url() === tenantUrl('kamalphysics', '/app') || await studentPage!.getByRole('group', { name: 'Your signed-in devices' }).isVisible()).toBe(true);
    if (await studentPage.getByRole('group', { name: 'Your signed-in devices' }).isVisible()) {
      await studentPage.getByRole('radio').first().check();
      await studentPage.getByRole('button', { name: 'Sign out this device and continue' }).click();
    }
    await expect(studentPage).toHaveURL(tenantUrl('kamalphysics', '/app'));
    await studentPage.goto(tenantUrl('kamalphysics', '/app/pay'));
    await expect(studentPage.getByRole('heading', { name: 'Payment history' })).toBeVisible();
    const newest = studentPage.getByRole('heading', { name: 'Payment history' }).locator('..').locator('li, tbody tr').filter({ visible: true }).first();
    await expect(newest.getByText('Paid', { exact: true })).toBeVisible();
    await expect(newest.getByText(/Cash/)).toBeVisible();
    await expect(newest.getByRole('button', { name: 'Download receipt' })).toBeVisible();
    const own = await studentPage.evaluate(async () => (await fetch('/api/v1/me/fees')).json()) as { payments: { id: string; studentId: string }[] };
    expect(own.payments.some(p => p.id === payment.id && p.studentId === fixture.studentId)).toBe(true);
    await viewportChecks(studentPage, name => info.outputPath(`student-${name}`));
    await page.goto(tenantUrl('kamalphysics', '/admin/fees'));
    await viewportChecks(page, name => info.outputPath(`payments-${name}`));
  } finally {
    await receiptPage?.close();
    if (studentPage && await studentPage.getByRole('button', { name: 'Log out' }).first().isVisible()) await logout(studentPage);
    await studentContext.close();
    if (paymentId) {
      // Restore open months via the real owner reversal; retain the append-only payment/audit history.
      const result = await ownerPage.evaluate(async id => {
        const res = await fetch(`/api/v1/admin/payments/${id}/reverse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Completed cash journey fixture cleanup' }) });
        return res.status;
      }, paymentId);
      expect(result).toBe(200);
    }
    await ownerContext.close();
  }
});
