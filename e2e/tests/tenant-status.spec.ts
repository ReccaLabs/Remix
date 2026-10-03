import { expect, test } from '@playwright/test';
import { CLOSED_OWNER, PASSWORD } from '../support/accounts';
import { loginStaff, logout } from '../support/auth';
import { tenantUrl } from '../support/env';

// TEN-06: a suspended institute has no student portal, and its staff only get billing.
test.describe('TEN-06 suspended institute', () => {
  test('students see "temporarily unavailable" instead of the login form', async ({ page }) => {
    for (const path of ['/login', '/app']) {
      await page.goto(tenantUrl('closedacademy', path));
      await expect(
        page.getByRole('heading', { level: 1, name: 'Closed Academy is temporarily unavailable' }),
      ).toBeVisible();
      await expect(page.getByLabel('Phone number')).toHaveCount(0);
    }
  });

  test('the API refuses a student login on a suspended institute', async ({ page }) => {
    await page.goto(tenantUrl('closedacademy', '/login'));
    // CA-1 is a seeded student; the tenant status is checked before the credentials.
    const result = await page.evaluate(async (password) => {
      const res = await fetch('/api/v1/auth/student/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '0750000001', password, staySignedIn: false }),
      });
      return { status: res.status, body: await res.text() };
    }, PASSWORD);
    expect(result.status).toBe(403);
    expect(result.body).toContain('TENANT_UNAVAILABLE');
  });

  test('the owner logs in and gets only the billing notice', async ({ page }) => {
    await loginStaff(page, 'closedacademy', CLOSED_OWNER.phone, PASSWORD, CLOSED_OWNER.seedPhone);

    await expect(
      page.getByRole('heading', { level: 1, name: "Closed Academy's account is suspended" }),
    ).toBeVisible();
    await expect(page.getByText(/only billing is available/i)).toBeVisible();
    // No dashboard behind it.
    await expect(page.getByText('Fees collected this month')).toHaveCount(0);

    await logout(page);
    await expect(page).toHaveURL(tenantUrl('closedacademy', '/admin/login'));
  });
});
