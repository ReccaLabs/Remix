import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, kamalStudent, royalStudent } from '../support/accounts';
import { loginStudent, submitStudentLogin } from '../support/auth';
import { origin, tenantUrl } from '../support/env';

/** Status of GET /api/v1/auth/session as the browser sends it (cookies included) to its own host. */
async function sessionStatus(page: Page): Promise<number> {
  return page.evaluate(async () => (await fetch('/api/v1/auth/session')).status);
}

// J-12 (part): tenant A's credentials and session mean nothing on tenant B's host.
test.describe('J-12 cross-tenant', () => {
  test('a kamalphysics session cookie replayed on royalscience is no session', async ({
    page,
    context,
  }, testInfo) => {
    await loginStudent(page, 'kamalphysics', kamalStudent(1, testInfo.project.name), PASSWORD);

    const cookies = await context.cookies(origin('kamalphysics'));
    const session = cookies.find((c) => c.name === 'remix_session');
    expect(session, 'the API set a session cookie').toBeDefined();
    // Control: the cookie really is a live session on its own host.
    expect(await sessionStatus(page)).toBe(200);

    // Replay the very same cookie value on royalscience.
    await context.addCookies([
      {
        name: 'remix_session',
        value: session?.value ?? '',
        url: origin('royalscience'),
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await page.goto(tenantUrl('royalscience', '/app'));
    await expect(page).toHaveURL(/^http:\/\/royalscience\.localhost:\d+\/login(\?|$)/);
    await expect(page.getByRole('heading', { level: 1, name: 'Student login' })).toBeVisible();
    expect(await sessionStatus(page)).toBe(401);
  });

  test('a royalscience student cannot log in on kamalphysics', async ({ page }, testInfo) => {
    const phone = royalStudent(0, testInfo.project.name);

    // The credentials are real: they work on their own institute.
    await loginStudent(page, 'royalscience', phone, PASSWORD);

    // On another institute's host the same phone and password are simply wrong.
    await submitStudentLogin(page, 'kamalphysics', phone, PASSWORD);
    await expect(
      page.getByRole('alert').filter({
        hasText: 'The phone number or password is wrong. Check them and try again.',
      }),
    ).toBeVisible();
    await expect(page).toHaveURL(tenantUrl('kamalphysics', '/login'));
    expect(await sessionStatus(page)).toBe(401);
  });
});
