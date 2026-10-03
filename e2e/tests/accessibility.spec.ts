import { expect, test } from '@playwright/test';
import { PASSWORD, SUNIL, kamalStudent } from '../support/accounts';
import { loginStaff, loginStudent } from '../support/auth';
import { expectNoSeriousA11yViolations } from '../support/axe';
import { tenantUrl } from '../support/env';

// axe on real pages with the real CSS loaded, so colour contrast is checked too.
test.describe('accessibility (axe: no serious or critical violations)', () => {
  test('student and staff login pages', async ({ page }) => {
    await page.goto(tenantUrl('kamalphysics', '/login'));
    await expect(page.getByRole('heading', { level: 1, name: 'Student login' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    await page.goto(tenantUrl('kamalphysics', '/admin/login'));
    await expect(page.getByRole('heading', { level: 1, name: 'Staff login' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('student home and classes', async ({ page }, testInfo) => {
    await loginStudent(page, 'kamalphysics', kamalStudent(3, testInfo.project.name), PASSWORD);
    await expect(page.getByRole('heading', { level: 2, name: 'Your classes' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    await page.goto(tenantUrl('kamalphysics', '/app/classes'));
    await expect(page.locator('article h2').first()).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('admin home', async ({ page }) => {
    await loginStaff(page, 'kamalphysics', SUNIL.email, PASSWORD, SUNIL.seedPhone);
    await expect(page.getByRole('heading', { level: 1, name: /Sunil/ })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});
