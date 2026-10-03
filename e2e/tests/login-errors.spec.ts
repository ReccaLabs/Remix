import { expect, test } from '@playwright/test';
import { PASSWORD, kamalStudent } from '../support/accounts';
import { submitStudentLogin } from '../support/auth';
import { tenantUrl } from '../support/env';

// Phone 0719999999 (BR-9999999) is far outside the seeded range BR-0801..BR-2800.
const UNKNOWN_PHONE = '071 999 9999';

test.describe('login errors', () => {
  test('a wrong password and an unknown phone show the same generic error', async ({
    page,
  }, testInfo) => {
    const alert = page.getByRole('alert').filter({ hasText: /wrong/i });

    await submitStudentLogin(
      page,
      'kamalphysics',
      kamalStudent(0, testInfo.project.name),
      'not-the-password',
    );
    await expect(alert).toBeVisible();
    const wrongPassword = (await alert.textContent())?.trim();

    await submitStudentLogin(page, 'kamalphysics', UNKNOWN_PHONE, PASSWORD);
    await expect(alert).toBeVisible();
    const unknownPhone = (await alert.textContent())?.trim();

    expect(wrongPassword).toBe('The phone number or password is wrong. Check them and try again.');
    expect(unknownPhone).toBe(wrongPassword);
    // Still on the login page, nothing was opened.
    await expect(page).toHaveURL(tenantUrl('kamalphysics', '/login'));
  });
});
