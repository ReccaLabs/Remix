import { expect, test } from '@playwright/test';
import { PASSWORD, kamalStudent } from '../support/accounts';
import { submitStudentLogin } from '../support/auth';
import { tenantUrl } from '../support/env';

test.describe('routing', () => {
  test('an unknown host is a 404', async ({ page }) => {
    for (const path of ['/', '/login', '/app']) {
      const response = await page.goto(tenantUrl('nope', path));
      expect(response?.status(), `nope.localhost${path}`).toBe(404);
    }
  });

  test('internal /tenant and /platform paths are not reachable directly', async ({ page }) => {
    for (const path of ['/tenant', '/tenant/login', '/tenant/app', '/platform', '/platform/x']) {
      const response = await page.goto(tenantUrl('kamalphysics', path));
      expect(response?.status(), path).toBe(404);
    }
  });

  test('?next= never leaves the institute: //evil.example ends on /app', async ({
    page,
  }, testInfo) => {
    await submitStudentLogin(
      page,
      'kamalphysics',
      kamalStudent(2, testInfo.project.name),
      PASSWORD,
      '/login?next=//evil.example',
    );
    await expect(page).toHaveURL(tenantUrl('kamalphysics', '/app'));

    // A signed-in student opening the same link is also sent to the portal, not off-site.
    await page.goto(tenantUrl('kamalphysics', '/login?next=//evil.example'));
    await expect(page).toHaveURL(tenantUrl('kamalphysics', '/app'));
  });
});
