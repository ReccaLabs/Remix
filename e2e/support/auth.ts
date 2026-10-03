import { createHash } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { tenantUrl } from './env';

/**
 * Owner/admin/cashier need an SMS code on an untrusted computer (AUTH-05). The dev seed gives
 * each of them one trusted computer whose trust cookie is derived from tenant + phone — the same
 * derivation as `devTrustToken` in packages/db/src/seed/index.ts. Setting it here lets a journey
 * sign in through the real form without an SMS (the two-step itself is covered by API tests).
 */
export async function useSeededTrustedComputer(
  page: Page,
  slug: string,
  phoneE164: string,
): Promise<void> {
  const value = createHash('sha256')
    .update(`remix-dev-trust|${slug}|${phoneE164}`)
    .digest('base64url');
  await page.context().addCookies([
    {
      name: 'remix_trust',
      value,
      url: tenantUrl(slug, '/'),
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

/** Student login through the real form: phone + password, "Log in". Does not wait for the result. */
export async function submitStudentLogin(
  page: Page,
  slug: string,
  phone: string,
  password: string,
  path = '/login',
): Promise<void> {
  await page.goto(tenantUrl(slug, path));
  await page.getByLabel('Phone number').fill(phone);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

/** A successful student login ends on the portal home. */
export async function loginStudent(
  page: Page,
  slug: string,
  phone: string,
  password: string,
): Promise<void> {
  await submitStudentLogin(page, slug, phone, password);
  await expect(page).toHaveURL(tenantUrl(slug, '/app'));
}

/** Staff login through the real form at /admin/login (phone or email). */
export async function submitStaffLogin(
  page: Page,
  slug: string,
  identifier: string,
  password: string,
): Promise<void> {
  await page.goto(tenantUrl(slug, '/admin/login'));
  await page.getByLabel('Phone or email').fill(identifier);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function loginStaff(
  page: Page,
  slug: string,
  identifier: string,
  password: string,
  /** For two-step roles: the seeded phone whose trusted computer this browser uses. */
  trustedPhone?: string,
): Promise<void> {
  if (trustedPhone) await useSeededTrustedComputer(page, slug, trustedPhone);
  await submitStaffLogin(page, slug, identifier, password);
  await expect(page).toHaveURL(tenantUrl(slug, '/admin'));
}

/** The top bar's Log out (some pages, like Me, repeat it in the page body). */
export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Log out' }).first().click();
}
