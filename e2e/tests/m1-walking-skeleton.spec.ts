import { expect, test } from '@playwright/test';
import { KAMAL_CLASSES, NIMALI, OTHER_TENANT_CLASSES, PASSWORD } from '../support/accounts';
import { loginStudent, logout } from '../support/auth';
import { tenantUrl } from '../support/env';
import { watchPageHealth } from '../support/page-health';

test.describe('M1 walking skeleton', () => {
  test('student logs in, sees her classes, walks Home, Classes, Me and logs out', async ({
    page,
  }) => {
    const health = await watchPageHealth(page);

    await loginStudent(page, 'kamalphysics', NIMALI.phone, PASSWORD);

    // Home: greeting by first name and her classes summary.
    await expect(page.getByRole('heading', { level: 1, name: 'Hi Nimali' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Your classes' })).toBeVisible();

    // Classes: real seeded class names (only this institute's), with a matching count.
    await page.getByRole('link', { name: 'Classes', exact: true }).click();
    await expect(page).toHaveURL(tenantUrl('kamalphysics', '/app/classes'));
    await expect(page.getByRole('heading', { level: 1, name: 'My classes' })).toBeVisible();
    const cards = page.locator('article h2');
    await expect(cards.first()).toBeVisible();
    // The seed is deterministic: BR-1042 takes the two 2027 A/L classes of Kamal Physics.
    const names = (await cards.allTextContents()).sort();
    expect(names).toEqual(NIMALI.classes);
    for (const name of names) expect(KAMAL_CLASSES).toContain(name);
    for (const other of OTHER_TENANT_CLASSES) {
      await expect(page.getByText(other, { exact: true })).toHaveCount(0);
    }
    await expect(
      page.getByText(names.length === 1 ? '1 class' : `${names.length} classes`, { exact: true }),
    ).toBeVisible();

    // Me: who she is, and the log out button.
    await page.getByRole('link', { name: 'Me', exact: true }).click();
    await expect(page).toHaveURL(tenantUrl('kamalphysics', '/app/me'));
    await expect(page.getByRole('main').getByText(NIMALI.name, { exact: true })).toBeVisible();

    // Logout lands on the login page; the portal is closed again.
    await logout(page);
    await expect(page).toHaveURL(tenantUrl('kamalphysics', '/login'));
    await page.goto(tenantUrl('kamalphysics', '/app'));
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expect(page.getByRole('heading', { level: 1, name: 'Student login' })).toBeVisible();

    // No console errors, page errors or CSP violations anywhere on the journey.
    health.expectClean();
  });
});
