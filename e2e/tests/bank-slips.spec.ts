import { expect, test, type ConsoleMessage, type Page, type Request, type Response } from '@playwright/test';
import { KAMAL, PASSWORD } from '../support/accounts';
import { loginStaffCached, loginStudentOnAnyDevice, scopeClientIp } from '../support/auth';
import { expectNoSeriousA11yViolations } from '../support/axe';
import { tenantUrl } from '../support/env';
import { colomboMonth, creditWallet, monthUnlocked, pageApi, prepareStudents, reversePaymentsFor, type JourneyStudent } from '../support/money';
import { hydrated } from '../support/hydration';
import { slipFile } from '../support/slip-image';

const CASHIER_PHONE = '+94770001182';
const BANK = { bankName: 'Test Bank', branch: 'Colombo Fort', accountNumber: '1234567890', accountName: 'Kamal Physics Test' };

interface QueueSlip { id: string; studentId: string; status: string }

/** The student sends the slip form (photo straight to private storage, then the slip) and returns the new slip's id. */
async function sendSlip(student: Page, reference: string): Promise<string> {
  await student.goto(tenantUrl('kamalphysics', '/app/pay'));
  await expect(student.getByRole('heading', { name: 'Institute bank details' })).toBeVisible();
  await hydrated(student.getByRole('button', { name: 'Send slip' }));
  await student.getByLabel('Slip photo').setInputFiles(slipFile());
  await student.getByLabel('Reference number (on the slip)').fill(reference);
  const submitted = student.waitForResponse((r) => r.url().endsWith('/api/v1/me/slips') && r.request().method() === 'POST');
  // What the browser saw, for the failure message: the storage PUT, blocked requests, console errors.
  const notes: string[] = [];
  const onFailed = (r: Request) => notes.push(`request failed: ${r.method()} ${new URL(r.url()).origin} ${r.failure()?.errorText ?? ''}`);
  const onResponse = (r: Response) => { if (r.request().method() === 'PUT') notes.push(`PUT ${new URL(r.url()).origin} -> ${r.status()}`); };
  const onConsole = (m: ConsoleMessage) => { if (m.type() === 'error') notes.push(`console: ${m.text().replace(/\?[^ ']*/, '?…').slice(0, 400)}`); };
  student.on('requestfailed', onFailed); student.on('response', onResponse); student.on('console', onConsole);
  await student.getByRole('button', { name: 'Send slip' }).click();
  // Say why when the form refuses (validation, photo upload) instead of timing out on the request.
  const formAlert = student.getByRole('alert').filter({ hasText: /\S/ }).first();
  const refused = formAlert.waitFor({ timeout: 15_000 }).then(async () => `The slip form showed: ${await formAlert.innerText()}`).catch(() => new Promise<string>(() => undefined));
  const outcome = await Promise.race([submitted.then(() => 'sent'), refused]);
  student.off('requestfailed', onFailed); student.off('response', onResponse); student.off('console', onConsole);
  if (outcome !== 'sent') throw new Error(`${outcome} | ${notes.join(' | ')}`);
  const response = await submitted;
  expect([200, 201]).toContain(response.status());
  await expect(student.getByText('Slip sent', { exact: true })).toBeVisible();
  return ((await response.json()) as { id: string }).id;
}

/** The photo is checked in the background; the slip joins the cashier queue when that is done. */
async function waitForQueue(cashier: Page, slipId: string): Promise<void> {
  await expect
    .poll(async () => {
      const res = await pageApi<{ items: QueueSlip[] }>(cashier, 'GET', '/api/v1/admin/slips?status=submitted&pageSize=100');
      return res.body.items?.some((s) => s.id === slipId) ?? false;
    }, { message: 'slip reaches the queue', timeout: 20_000 })
    .toBe(true);
}

/** Keyboard S (skip) until the slip under review belongs to this student. */
async function skipToStudent(cashier: Page, name: string): Promise<void> {
  const heading = cashier.locator('#slip-review-title');
  await hydrated(cashier.getByRole('button', { name: /^Approve/ }));
  for (let i = 0; i < 40; i++) {
    await expect(heading).toBeVisible();
    if ((await heading.innerText()).includes(name)) return;
    await cashier.keyboard.press('s');
  }
  throw new Error(`The slip of ${name} is not in the queue`);
}

async function responsive(page: Page, screenshot: (name: string) => string, label: string) {
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: screenshot(`${label}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await expectNoSeriousA11yViolations(page);
}

/** Reject any slip of this student still waiting from a failed earlier attempt (the queue is shared). */
async function clearWaitingSlips(owner: Page, student: JourneyStudent) {
  const queue = await pageApi<{ items: QueueSlip[] }>(owner, 'GET', '/api/v1/admin/slips?status=submitted&pageSize=100');
  for (const slip of queue.body.items ?? []) {
    if (slip.studentId === student.studentId) await pageApi(owner, 'POST', `/api/v1/admin/slips/${slip.id}/reject`, { reason: 'Journey reset' });
  }
}

/**
 * J-03 (docs/plan/04-quality.md): the student sends a bank slip photo → it appears in the cashier
 * queue → the cashier rejects it with R and a reason → the student sees the reason → sends it again
 * → the cashier approves with A → the months unlock and a receipt exists. Real SeaweedFS storage,
 * real media worker. Keyboard only on the cashier side.
 */
test('J-03 FEE-05/FEE-06: slip upload → queue → reject with reason → resubmit → approve unlocks the months', async ({ browser, page }, info) => {
  const mobile = info.project.name === 'mobile-chrome';
  const months = [colomboMonth(0), colomboMonth(1)];
  const [student] = await prepareStudents({ from: mobile ? 1850 : 1820, count: 1, months });
  if (!student) throw new Error('No journey student');
  const [month0, month1] = months as [string, string];
  const ip = (n: number) => ({ 'x-forwarded-for': `10.3${n}.0.${mobile ? 2 : 1}` });
  // Not `extraHTTPHeaders`: a header on the cross-origin storage PUT would add it to the CORS preflight.
  const studentContext = await browser.newContext({ ...info.project.use, extraHTTPHeaders: {} });
  await scopeClientIp(studentContext, tenantUrl('kamalphysics', '/'), ip(1)['x-forwarded-for']);
  const cashierContext = await browser.newContext({ ...info.project.use, extraHTTPHeaders: ip(2) });
  const studentPage = await studentContext.newPage();
  const cashier = await cashierContext.newPage();
  const stamp = Date.now();
  try {
    await loginStaffCached(page, 'kamalphysics', KAMAL.email, PASSWORD, KAMAL.seedPhone);
    await creditWallet(200_000);
    expect((await pageApi(page, 'PATCH', '/api/v1/admin/settings/fees', { bankDetails: BANK })).status).toBe(200);
    await reversePaymentsFor(page, student.studentId, student.lineIds, 'J-03 journey reset');
    await clearWaitingSlips(page, student);
    expect(await monthUnlocked(student.studentId, student.classId, month0)).toBe(false);

    await loginStudentOnAnyDevice(studentPage, 'kamalphysics', student.phone.replace('+94', '0'), PASSWORD);
    await loginStaffCached(cashier, 'kamalphysics', CASHIER_PHONE, PASSWORD, CASHIER_PHONE);

    // 1. Student uploads a slip for both months.
    const first = await sendSlip(studentPage, `J03-A-${stamp}`);
    await expect(studentPage.getByRole('region', { name: 'Your slips' }).getByText('Checking')).toBeVisible();
    await responsive(studentPage, (n) => info.outputPath(n), 'student-pay');

    // 2. It reaches the cashier queue (the tab shows how many wait); the cashier rejects it with R.
    await waitForQueue(cashier, first);
    await cashier.goto(tenantUrl('kamalphysics', '/admin/fees?tab=slips'));
    await expect(cashier.getByRole('navigation', { name: 'Fee views' }).getByRole('link', { name: /^Bank slips \d+ slips waiting$/ })).toHaveAttribute('aria-current', 'page');
    await skipToStudent(cashier, student.name);
    await expect(cashier.getByText(`J03-A-${stamp}`, { exact: true })).toBeVisible();
    await expect(cashier.getByText('Reference not used before')).toBeVisible();
    const photo = cashier.getByRole('img', { name: `Bank slip photo from ${student.name}` });
    await expect(photo).toBeVisible();
    await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await responsive(cashier, (n) => info.outputPath(n), 'queue');
    await cashier.keyboard.press('r');
    const dialog = cashier.getByRole('dialog', { name: `Reject slip from ${student.name}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Amount does not match').check();
    await dialog.getByLabel('Note (optional)').fill('Please check the total');
    await dialog.getByRole('button', { name: 'Reject slip' }).click();
    await expect(cashier.getByText('Rejected. The student can send a new slip.')).toBeVisible();

    // 3. The student sees the reason, and the months are still locked.
    await studentPage.reload();
    const mine = studentPage.getByRole('region', { name: 'Your slips' });
    const rejectedSlip = mine.getByRole('listitem').filter({ hasText: `J03-A-${stamp}` });
    await expect(rejectedSlip.getByText('Rejected', { exact: true })).toBeVisible();
    await expect(rejectedSlip.getByText('Reason: Amount does not match: Please check the total')).toBeVisible();
    await expect(studentPage.getByRole('region', { name: 'Open months' }).getByRole('listitem')).toHaveCount(2);
    expect(await monthUnlocked(student.studentId, student.classId, month0)).toBe(false);

    // 4. The student sends it again; the cashier approves with A.
    const second = await sendSlip(studentPage, `J03-B-${stamp}`);
    await waitForQueue(cashier, second);
    await cashier.goto(tenantUrl('kamalphysics', '/admin/fees?tab=slips'));
    await skipToStudent(cashier, student.name);
    await expect(cashier.getByText(`J03-B-${stamp}`, { exact: true })).toBeVisible();
    await cashier.keyboard.press('a');
    await expect(cashier.getByText('Approved. Receipt created.')).toBeVisible();

    // 5. Both months are unlocked, and the payment has a receipt.
    expect(await monthUnlocked(student.studentId, student.classId, month0)).toBe(true);
    expect(await monthUnlocked(student.studentId, student.classId, month1)).toBe(true);
    await studentPage.reload();
    await expect(studentPage.getByText('All months are paid')).toBeVisible();
    await expect(mine.getByRole('listitem').filter({ hasText: `J03-B-${stamp}` }).getByText('Approved', { exact: true })).toBeVisible();
    const history = studentPage.getByRole('heading', { name: 'Payment history' }).locator('..');
    // The history has a phone list and a desktop table in the page; one of them is hidden.
    await expect(history.getByText('Bank slip').filter({ visible: true }).first()).toBeVisible();
    await expect(history.getByRole('button', { name: 'Download receipt' }).filter({ visible: true }).first()).toBeVisible();
    await responsive(studentPage, (n) => info.outputPath(n), 'student-paid');

    // TODO(3-G, after PR #61 "slip SMS" is on main): assert the slip-rejected and slip-approved SMS
    // reach the guardian through the mock gateway (smsRecipient + deliveredSms) and that
    // `slip-rejected-<id>` / `slip-approved-<id>` rows exist in sms_messages.
  } finally {
    // Leave the months open for the next run: undo the approved payment (append-only history stays).
    await reversePaymentsFor(page, student.studentId, student.lineIds, 'J-03 journey cleanup').catch(() => 0);
    await clearWaitingSlips(page, student).catch(() => undefined);
    await studentContext.close();
    await cashierContext.close();
  }
});
