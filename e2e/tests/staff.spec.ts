import { expect, test } from '@playwright/test';
import { KAMAL, PASSWORD } from '../support/accounts';
import { loginStaff, logout } from '../support/auth';
import { tenantUrl } from '../support/env';

test.describe('staff login', () => {
  test('the owner logs in at /admin/login, sees the admin home with his name, and logs out', async ({
    page,
  }) => {
    await loginStaff(page, 'kamalphysics', KAMAL.email, PASSWORD);

    await expect(
      page.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), Kamal$/ }),
    ).toBeVisible();
    await expect(page.getByText('Signed in as Owner and Teacher')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Today at a glance' })).toBeAttached();

    await logout(page);
    await expect(page).toHaveURL(tenantUrl('kamalphysics', '/admin/login'));
    await page.goto(tenantUrl('kamalphysics', '/admin'));
    await expect(page).toHaveURL(/\/admin\/login(\?|$)/);
  });
});
