import { createHash } from 'node:crypto';
import { expect, type BrowserContext, type Page } from '@playwright/test';
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

/**
 * Gives one context its own client IP for the login limiter (the API trusts `X-Forwarded-For` from
 * loopback) on requests to the app's own origin only. Unlike the project's `extraHTTPHeaders`,
 * this leaves cross-origin requests alone: an extra header on the browser's PUT to the slip bucket
 * would be added to its CORS preflight, which the bucket rightly does not allow.
 */
export async function scopeClientIp(context: BrowserContext, appOrigin: string, ip: string): Promise<void> {
  const origin = new URL(appOrigin).origin;
  await context.route(
    (url) => url.origin === origin,
    (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }),
  );
}

/**
 * A student login that also gets through the device-limit step (a seeded student may already be at
 * the limit): the first device is signed out so the journey continues on /app.
 */
export async function loginStudentOnAnyDevice(
  page: Page,
  slug: string,
  phone: string,
  password: string,
): Promise<void> {
  await submitStudentLogin(page, slug, phone, password);
  await expect
    .poll(
      async () =>
        page.url() === tenantUrl(slug, '/app') ||
        (await page.getByRole('group', { name: 'Your signed-in devices' }).isVisible()),
    )
    .toBe(true);
  if (await page.getByRole('group', { name: 'Your signed-in devices' }).isVisible()) {
    await page.getByRole('radio').first().check();
    await page.getByRole('button', { name: 'Sign out this device and continue' }).click();
  }
  await expect(page).toHaveURL(tenantUrl(slug, '/app'));
}

const staffCookies = new Map<string, Awaited<ReturnType<BrowserContext['cookies']>>>();

/**
 * `loginStaff`, but one real sign-in per account is reused by later journeys in this worker, so the
 * money journeys do not spend an account's five-logins-a-minute budget between them (owner and
 * cashier sign in from several specs). Falls back to a real sign-in when the saved session is gone.
 */
export async function loginStaffCached(
  page: Page,
  slug: string,
  identifier: string,
  password: string,
  trustedPhone?: string,
): Promise<void> {
  const key = `${slug}|${identifier}`;
  const saved = staffCookies.get(key);
  if (saved) {
    await page.context().addCookies(saved);
    await page.goto(tenantUrl(slug, '/admin'));
    if (page.url() === tenantUrl(slug, '/admin')) return;
    await page.context().clearCookies();
  }
  await loginStaff(page, slug, identifier, password, trustedPhone);
  staffCookies.set(key, await page.context().cookies());
}

/** The top bar's Log out (some pages, like Me, repeat it in the page body). */
export async function logout(page: Page): Promise<void> {
  // A hard navigation can reach the expected URL before the client button is hydrated.
  await page.waitForLoadState('load');
  await page.getByRole('button', { name: 'Log out' }).first().click();
}
