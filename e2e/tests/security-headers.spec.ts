import { expect, test } from '@playwright/test';
import { tenantUrl } from '../support/env';
import { watchPageHealth } from '../support/page-health';

const NONCE = /script-src[^;]*'nonce-([A-Za-z0-9+/=_-]{16,})'/;

test.describe('security headers', () => {
  test('HTML responses carry a CSP with a fresh nonce each time', async ({ page }) => {
    const nonces: string[] = [];
    for (const path of ['/login', '/login', '/admin/login']) {
      const response = await page.goto(tenantUrl('kamalphysics', path));
      expect(response?.status()).toBe(200);
      const headers = response?.headers() ?? {};
      const csp = headers['content-security-policy'] ?? '';
      const nonce = NONCE.exec(csp)?.[1];
      expect(nonce, `nonce in CSP of ${path}`).toBeTruthy();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain("'unsafe-eval'");
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('DENY');
      nonces.push(nonce ?? '');
    }
    expect(new Set(nonces).size).toBe(nonces.length);
  });

  test('the 404 page carries the CSP too', async ({ page }) => {
    const response = await page.goto(tenantUrl('nope', '/'));
    expect(response?.status()).toBe(404);
    expect(response?.headers()['content-security-policy'] ?? '').toMatch(NONCE);
  });

  test('client-side form validation raises no CSP violation', async ({ page }) => {
    // Zod 4 probes `new Function('')` unless configured jitless (apps/web/src/lib/zod-client.ts);
    // the CSP rightly has no 'unsafe-eval', so a regression shows up here as a violation.
    const health = await watchPageHealth(page);
    await page.goto(tenantUrl('kamalphysics', '/login'));
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByText('Enter your phone number.')).toBeVisible();
    await page.waitForTimeout(500); // let the violation event reach the collector
    health.expectClean();
  });
});
