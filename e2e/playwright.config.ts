import { defineConfig, devices } from '@playwright/test';
import { API_PORT, DATABASE_URL, WEB_PORT, repoRoot } from './support/env';

/**
 * Phase 1 walking-skeleton journeys against the real stack: browser -> built web app -> built API
 * -> Postgres with row-level security. The stack (Postgres, migrated and seeded) must be up before
 * `playwright test`; see e2e/README.md. The web app and API are started here from their builds.
 *
 * Everything runs on one worker. The API's in-memory login limiter is 5 per minute per phone and
 * 20 per minute per client IP, so each project gets its own client IP (X-Forwarded-For, which the
 * API trusts from loopback) and each journey uses its own seeded student.
 */

const apiUrl = `http://localhost:${API_PORT}`;

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: './test-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        extraHTTPHeaders: { 'x-forwarded-for': '10.20.0.1' },
      },
    },
    {
      // Pixel-class phone, 390 wide (the design's phone width).
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
        extraHTTPHeaders: { 'x-forwarded-for': '10.20.0.2' },
      },
    },
  ],
  webServer: [
    {
      name: 'api',
      command: 'node --enable-source-maps apps/api/dist/main.js',
      cwd: repoRoot,
      url: `${apiUrl}/health/ready`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'development',
        PORT: API_PORT,
        LOG_LEVEL: process.env.E2E_API_LOG_LEVEL ?? 'warn',
        TRUST_PROXY: 'loopback',
        TENANT_BASE_DOMAINS: 'localhost',
        PLATFORM_HOSTS: 'admin.localhost',
        COOKIE_SECURE: 'false',
        DATABASE_URL,
      },
    },
    {
      name: 'web',
      // The production server of the built app. The /api/v1 rewrite to the API exists only when the
      // build was made with WEB_API_REWRITE=true (rewrites are fixed at build time).
      command: `pnpm exec next start -p ${WEB_PORT}`,
      cwd: `${repoRoot}/apps/web`,
      // A static file the proxy skips: 200 without needing a tenant host (Node may not resolve *.localhost).
      url: `http://127.0.0.1:${WEB_PORT}/icon.svg`,
      reuseExistingServer: false,
      timeout: 90_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        API_INTERNAL_URL: apiUrl,
        TENANT_BASE_DOMAINS: 'localhost',
        PLATFORM_HOSTS: 'admin.localhost',
      },
    },
  ],
});
