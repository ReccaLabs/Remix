import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { KAMAL, KAMAL_CLASSES, PASSWORD } from '../support/accounts';
import { loginStaff } from '../support/auth';
import { expectNoSeriousA11yViolations } from '../support/axe';
import { prepareCardMonths } from '../support/cards-fixture';
import { tenantUrl } from '../support/env';

async function responsive(page: Page, screenshot: (name: string) => string, label: string) {
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: screenshot(`${label}-${width}.png`), fullPage: true });
  }
  await expectNoSeriousA11yViolations(page);
}

test('STU-07/STU-06/FEE-07: create, print temporary, scan and take cash, order and hand over permanent', async ({
  page,
}, info) => {
  test.setTimeout(150_000);
  let print: Page | undefined;
  let sheet: Page | undefined;
  let receipt: Page | undefined;
  let studentId: string | undefined;
  let permanentId: string | undefined;
  let paymentId: string | undefined;
  try {
    await loginStaff(page, 'kamalphysics', KAMAL.email, PASSWORD, KAMAL.seedPhone);
    await page.goto(tenantUrl('kamalphysics', '/admin/students/new'));
    const name = `Card Journey ${info.project.name} ${Date.now()}`;
    await page.getByLabel('Full name', { exact: true }).fill(name);
    await page
      .getByLabel('Phone number', { exact: true })
      .first()
      .fill(`0779${String(Date.now() % 1_000_000).padStart(6, '0')}`);
    await page.getByRole('checkbox', { name: KAMAL_CLASSES[0], exact: true }).check();
    const created = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/admin/students') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Add student', exact: true }).click();
    const createResponse = await created;
    expect(createResponse.status()).toBe(201);
    const student = (await createResponse.json()) as { id: string; studentNo: string };
    studentId = student.id;
    const year = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Colombo', year: 'numeric' })
      .format(new Date())
      .slice(-2);
    expect(student.studentNo).toMatch(new RegExp(`^[A-Z]{2,4}-${year}-\\d{4,}$`));
    await expect(page).toHaveURL(tenantUrl('kamalphysics', `/admin/students/${student.id}`));
    await expect(page.getByText(student.studentNo, { exact: true }).first()).toBeVisible();
    const months = await prepareCardMonths(student.id);
    const popup = page.waitForEvent('popup');
    const issued = page.waitForResponse(
      (r) => r.url().endsWith(`/students/${student.id}/cards`) && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Print temporary card' }).click();
    const temp = (await (await issued).json()) as { id: string; code: string };
    expect(temp.code).toBe(`${student.studentNo}-1`);
    print = await popup;
    await print.waitForURL(tenantUrl('kamalphysics', `/admin/students/${student.id}/card/print`));
    await expect(print.getByRole('img', { name: `Barcode: ${temp.code}` })).toBeVisible();
    await responsive(print, (n) => info.outputPath(n), 'temporary');
    const box = await print.getByRole('article').boundingBox();
    expect(box?.width).toBeCloseTo((85.6 * 96) / 25.4, 0);
    expect(box?.height).toBeCloseTo((54 * 96) / 25.4, 0);
    await responsive(page, (n) => info.outputPath(n), 'profile');
    await page.goto(tenantUrl('kamalphysics', '/admin/fees?tab=cash'));
    await page.getByLabel('Search student').fill(temp.code);
    await page.getByLabel('Search student').press('Enter');
    await expect(page.getByText('Temporary card', { exact: true })).toBeVisible();
    const open = page.getByRole('checkbox', { name: new RegExp(months.className) }).first();
    await expect(open).toBeVisible();
    await open.check();
    await page.getByLabel('Cash received (LKR)').fill(String(months.totalCents / 100));
    await responsive(page, (n) => info.outputPath(n), 'counter');
    const paid = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/admin/payments/cash') && r.request().method() === 'POST',
    );
    const receiptPopup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Collect & print receipt' }).click();
    const paymentResponse = await paid;
    const payment = (await paymentResponse.json()) as { id: string };
    paymentId = payment.id;
    expect(paymentResponse.status()).toBe(200);
    receipt = await receiptPopup;
    await receipt.waitForURL(/\/admin\/receipts\/.+\/print/);
    await page.goto(tenantUrl('kamalphysics', `/admin/students/${student.id}`));
    await page.getByRole('button', { name: 'Order permanent card' }).click();
    await page.getByLabel('QR', { exact: true }).check();
    await page.getByLabel('NFC', { exact: true }).check();
    const orderResponse = page.waitForResponse(
      (r) => r.url().endsWith(`/students/${student.id}/cards`) && r.request().method() === 'POST',
    );
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Order permanent card' })
      .click();
    const permanent = (await (await orderResponse).json()) as { id: string; code: string };
    permanentId = permanent.id;
    await expect(page.getByText('Ordered - ReMix is printing it', { exact: true })).toBeVisible();
    await page.goto(tenantUrl('kamalphysics', '/admin/students'));
    await page.getByRole('link', { name: 'Cards', exact: true }).click();
    await expect(page.getByText(`Card code: ${permanent.code}`, { exact: true })).toBeVisible();
    const csvDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download CSV' }).click();
    const download = await csvDownload;
    const path = await download.path();
    expect(path).toBeTruthy();
    expect(await readFile(path!, 'utf8')).toContain(`"${permanent.code}"`);
    await responsive(page, (n) => info.outputPath(n), 'cards');
    sheet = await page.context().newPage();
    await sheet.goto(tenantUrl('kamalphysics', '/admin/students/cards/print'));
    await expect(sheet.getByRole('img', { name: `QR: ${permanent.code}` })).toBeVisible();
    await expect(sheet.getByText('Permanent card / NFC')).toBeVisible();
    await responsive(sheet, (n) => info.outputPath(n), 'sheet');
    await page.goto(tenantUrl('kamalphysics', `/admin/students/${student.id}`));
    await page.getByRole('button', { name: 'Hand over card' }).click();
    await expect(page.getByLabel('Chip UID (optional)')).toBeVisible();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Hand over card' }).click();
    await expect(page.getByRole('alertdialog')).not.toBeVisible();
    await page.getByText('Card history', { exact: true }).click();
    await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
    await page.goto(tenantUrl('kamalphysics', '/admin/fees?tab=cash'));
    await page.getByLabel('Search student').fill(temp.code);
    await page.getByLabel('Search student').press('Enter');
    await expect(page.getByRole('alert').filter({ hasText: 'Card revoked' })).toHaveText(
      'Card revoked — ask for ID and use search.',
    );
    await expect(page.getByLabel('Cash received (LKR)')).toHaveCount(0);
    await page.getByLabel('Search student').fill(permanent.code);
    await page.getByLabel('Search student').press('Enter');
    await expect(page.getByText('Card', { exact: true })).toBeVisible();
    await page.goto(tenantUrl('kamalphysics', '/admin/students/cards'));
    await expect(page.getByText(`Card code: ${permanent.code}`, { exact: true })).toHaveCount(0);
  } finally {
    for (const popup of [print, sheet, receipt]) await popup?.close();
    // Keep append-only history while restoring money and archiving only this journey's student.
    if (studentId) {
      const statuses = await page.evaluate(
        async ({ studentId, permanentId, paymentId }) => {
          const post = async (path: string, body: object) =>
            (
              await fetch(path, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
              })
            ).status;
          const results: number[] = [];
          if (paymentId)
            results.push(
              await post(`/api/v1/admin/payments/${paymentId}/reverse`, {
                reason: 'Completed card journey cleanup',
              }),
            );
          if (permanentId)
            results.push(
              await post(`/api/v1/admin/cards/${permanentId}/revoke`, {
                reason: 'Completed card journey cleanup',
              }),
            );
          results.push(
            await post('/api/v1/admin/students/bulk', {
              action: 'archive',
              studentIds: [studentId],
            }),
          );
          return results;
        },
        { studentId, permanentId, paymentId },
      );
      expect(statuses.every((status) => status === 200)).toBe(true);
    }
  }
});
