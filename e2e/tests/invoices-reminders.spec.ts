import { expect, test, type Page } from '@playwright/test';
import { KAMAL, PASSWORD } from '../support/accounts';
import { loginStaff } from '../support/auth';
import { expectNoSeriousA11yViolations } from '../support/axe';
import { tenantUrl } from '../support/env';
import { countSms, deliveredSms, smsOffset } from '../support/mock-sms';
import { colomboMonth, creditWallet, pageApi, prepareStudents, smsRecipient, walletBalance } from '../support/money';

const CASHIER_PHONE = '+94770001182';

/** "LKR 1,234.50" -> 123450 */
const lkrToCents = (text: string): number => Math.round(Number(text.replace(/[^0-9.]/g, '')) * 100);

async function noHorizontalScroll(page: Page, screenshot: (name: string) => string, label: string) {
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: screenshot(`${label}-${width}.png`), fullPage: true });
  }
}

/**
 * J-09 (docs/plan/04-quality.md): the month's invoices exist and are overdue → Invoices tab overdue
 * filter → "Send reminder SMS to N unpaid" → cost preview → send → messages queued and the wallet
 * debited once → the same idempotency key does not charge again. The monthly invoice generation
 * itself (idempotent, per tenant) is covered by the API integration tests; this journey seeds the
 * invoices the job would have created, the way the other money journeys do.
 */
test('J-09 FEE-02/FEE-12/MSG-02: overdue filter → reminder SMS with cost preview → queued, debited once', async ({ page, browser }, info) => {
  const month = colomboMonth(-1);
  const students = await prepareStudents({ from: info.project.name === 'mobile-chrome' ? 1730 : 1700, count: 3, months: [month], dueDay: 5 });
  const cashierContext = await browser.newContext({ ...info.project.use, extraHTTPHeaders: { 'x-forwarded-for': `10.29.0.${info.project.name === 'chromium' ? 1 : 2}` } });
  const cashierPage = await cashierContext.newPage();
  try {
    await creditWallet(200_000);
    await loginStaff(page, 'kamalphysics', KAMAL.email, PASSWORD, KAMAL.seedPhone);

    // Overdue filter: the journey's students are listed with the word "Overdue".
    await page.goto(tenantUrl('kamalphysics', `/admin/fees?tab=invoices&month=${month}&filter=overdue`));
    const tabs = page.getByRole('navigation', { name: 'Fee views' });
    for (const name of ['Payments', 'Invoices', /^Bank slips/, 'Cash counter']) await expect(tabs.getByRole('link', { name })).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'Invoices' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('navigation', { name: 'Invoice status' }).getByRole('link', { name: 'Overdue' })).toHaveAttribute('aria-current', 'page');
    for (const s of students) {
      const row = page.locator('tr').filter({ hasText: s.name });
      await expect(row).toBeVisible();
      await expect(row.getByText('Overdue', { exact: true })).toBeVisible();
    }
    await noHorizontalScroll(page, (n) => info.outputPath(n), 'invoices');
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectNoSeriousA11yViolations(page);

    // N in the button is the count the dialog's preview shows.
    const remind = page.getByRole('button', { name: /^Send reminder SMS to \d+ unpaid$/ });
    await expect(remind).toBeVisible();
    const buttonCount = Number(/to (\d+) unpaid/.exec((await remind.textContent()) ?? '')?.[1]);
    expect(buttonCount).toBeGreaterThanOrEqual(students.length);
    await remind.click();
    const dialog = page.getByRole('dialog', { name: 'Send reminder SMS' });
    await expect(dialog).toBeVisible();
    // Cost preview: recipients, segments, cost, wallet balance, a sample text.
    const figure = (label: string) => dialog.locator('dt', { hasText: label }).locator('xpath=following-sibling::dd[1]');
    await expect(figure('Messages')).toHaveText(String(buttonCount));
    const cost = lkrToCents((await figure('Cost').textContent()) ?? '');
    const balanceShown = lkrToCents((await figure('Wallet balance').textContent()) ?? '');
    expect(cost).toBeGreaterThan(0);
    expect(balanceShown).toBe(await walletBalance());
    expect(balanceShown).toBeGreaterThanOrEqual(cost);
    await expect(dialog.getByText('Sample message')).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    const recipient = await smsRecipient(students[0]!.studentId);
    const smsFrom = smsOffset();
    const before = await walletBalance();
    const sent = page.waitForRequest((r) => r.url().endsWith('/api/v1/admin/invoices/reminders/send') && r.method() === 'POST');
    const reply = page.waitForResponse((r) => r.url().endsWith('/api/v1/admin/invoices/reminders/send'));
    await dialog.getByRole('button', { name: `Send ${buttonCount} reminders` }).click();
    const body = (await sent).postDataJSON() as { month: string; filter: string; idempotencyKey: string };
    const result = (await (await reply).json()) as { queued: number; costCents: number };
    expect(result).toEqual({ queued: buttonCount, costCents: cost });
    await expect(page.getByText(`${buttonCount} messages queued, `).first()).toBeVisible();
    await expect(dialog).toBeHidden();

    // The wallet was debited by exactly the previewed cost, and the message really went out (mock gateway).
    expect(before - (await walletBalance())).toBe(cost);
    await deliveredSms(recipient, smsFrom, /(was due on \d+ \w+ and is unpaid)/);
    await expect.poll(() => countSms(smsFrom)).toBe(buttonCount);

    // Replaying the identical request (same idempotency key) charges and sends nothing more.
    const afterFirst = await walletBalance();
    const smsAfterFirst = smsOffset();
    const replay = await pageApi<{ queued: number; costCents: number }>(page, 'POST', '/api/v1/admin/invoices/reminders/send', body);
    expect(replay.status).toBe(200);
    expect(await walletBalance()).toBe(afterFirst);
    await page.waitForTimeout(1000);
    expect(countSms(smsAfterFirst)).toBe(0);

    // A cashier sees the invoices but has no SMS controls (permissions.ts: sms.send is owner/admin only).
    await loginStaff(cashierPage, 'kamalphysics', CASHIER_PHONE, PASSWORD, CASHIER_PHONE);
    await cashierPage.goto(tenantUrl('kamalphysics', `/admin/fees?tab=invoices&month=${month}&filter=overdue`));
    await expect(cashierPage.locator('tr').filter({ hasText: students[0]!.name })).toBeVisible();
    await expect(cashierPage.getByRole('button', { name: /Send reminder SMS/ })).toHaveCount(0);
    expect((await pageApi(cashierPage, 'POST', '/api/v1/admin/invoices/reminders/preview', { month, filter: 'unpaid' })).status).toBe(403);
  } finally {
    await cashierContext.close();
  }
});
