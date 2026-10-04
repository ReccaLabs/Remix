import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { KAMAL, PASSWORD, kamalStudentPhone } from '../support/accounts';
import {
  loginStaff,
  loginStudent,
  logout,
  submitStaffLogin,
  submitStudentLogin,
} from '../support/auth';
import { tenantUrl } from '../support/env';
import { deliveredSms, smsOffset } from '../support/mock-sms';

const SLUG = 'kamalphysics';
let ownerCookies: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;
// Reuse a real sign-in within this worker: four owner journeys must not spend the same
// account's five-logins/minute budget, especially when CI runs both projects quickly.
async function owner(page: Page) {
  if (ownerCookies) {
    await page.context().addCookies(ownerCookies);
    await page.goto(tenantUrl(SLUG, '/admin'));
    await expect(page).toHaveURL(tenantUrl(SLUG, '/admin'));
  } else {
    await loginStaff(page, SLUG, KAMAL.email, PASSWORD, KAMAL.seedPhone);
    ownerCookies = await page.context().cookies();
  }
}
const projectIndex = (name: string) => (name === 'mobile-chrome' ? 1 : 0);

async function retireInviteFixtures(page: Page, name?: string) {
  const staff = await apiGet<{
    items: { id: string; displayName: string; phone: string | null; status: string }[];
  }>(page, '/api/v1/admin/staff');
  for (const member of staff.items) {
    if (
      !/^Invited (owner|cashier) [a-f0-9]{8}$/.test(member.displayName) ||
      !member.phone?.startsWith('+94767') ||
      (name !== undefined && member.displayName !== name)
    )
      continue;
    if (member.status === 'invited') {
      const res = await apiRequest(page, `/api/v1/admin/staff/invites/${member.id}`, 'DELETE');
      expect(res.status).toBe(204);
    } else if (member.status === 'active') {
      const res = await apiRequest(page, `/api/v1/admin/staff/${member.id}`, 'PATCH', {
        status: 'disabled',
      });
      expect(res.status).toBe(200);
    }
  }
}

async function expectReadOnly(page: Page, role: string) {
  await page.goto(tenantUrl(SLUG, '/admin/students'));
  await expect(page.getByRole('link', { name: 'Add student', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Import CSV', exact: true })).toHaveCount(0);
  await page.goto(tenantUrl(SLUG, '/admin/classes'));
  await expect(page.getByRole('link', { name: 'Create class', exact: true })).toHaveCount(0);
  for (const path of [
    '/api/v1/admin/classes',
    '/api/v1/admin/students',
    '/api/v1/admin/staff/invites',
    '/api/v1/admin/imports/students/commit',
  ]) {
    const res = await apiRequest(page, path, 'POST', {});
    expect(res.status, `${role}: ${path}`).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  }
}

test.beforeEach(async ({ page }, info) => {
  const ip = createHash('sha256').update(`${info.testId}:${info.retry}`).digest();
  await page.context().setExtraHTTPHeaders({
    'x-forwarded-for': `10.23.${ip.readUInt8(0)}.${ip.readUInt8(1)}`,
  });
});

test.afterAll(async ({ browser }, info) => {
  if (!ownerCookies) return;
  const ctx = await browser.newContext({ ...info.project.use });
  try {
    await ctx.addCookies(ownerCookies);
    const page = await ctx.newPage();
    await page.goto(tenantUrl(SLUG, '/admin'));
    const signedOut = await apiRequest(page, '/api/v1/auth/logout', 'POST');
    expect(signedOut.status).toBe(204);
  } finally {
    ownerCookies = undefined;
    await ctx.close();
  }
});

async function apiRequest(page: Page, path: string, method = 'GET', data?: unknown) {
  return page.evaluate(
    async ({ path, method, data }) => {
      const res = await fetch(path, {
        method,
        ...(method === 'GET'
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data ?? {}) }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { path, method, data },
  );
}

async function apiGet<T>(page: Page, path: string): Promise<T> {
  const res = await apiRequest(page, path);
  expect(res.status).toBe(200);
  return res.body as T;
}

test.describe('Phase 2 closeout journeys', () => {
  test('J-01: third device replaces one session; an admin revokes another from the profile', async ({
    browser,
    page,
  }, info) => {
    const contexts: BrowserContext[] = [];
    try {
      // Inherit the desktop/phone project's device settings, with separate cookie jars.
      for (let i = 0; i < 3; i++)
        contexts.push(
          await browser.newContext({
            ...info.project.use,
            extraHTTPHeaders: {
              'x-forwarded-for': `10.21.${projectIndex(info.project.name)}.${i + 1}`,
            },
          }),
        );
      const [a, b, c] = await Promise.all(contexts.map((ctx) => ctx.newPage()));
      if (!a || !b || !c) throw new Error('Three device contexts required');
      const phone = kamalStudentPhone(1501 + projectIndex(info.project.name) + info.retry * 20);
      await loginStudent(a, SLUG, phone, PASSWORD);
      const session = await apiGet<{ user: { id: string } }>(a, '/api/v1/auth/session');
      const devices = await apiGet<{ items: { id: string }[] }>(a, '/api/v1/me/devices');
      const deviceA = devices.items[0]?.id;
      if (!deviceA) throw new Error('Device A missing');
      await loginStudent(b, SLUG, phone, PASSWORD);
      await submitStudentLogin(c, SLUG, phone, PASSWORD);
      await expect(c.getByRole('heading', { name: "You're signed in on 2 devices" })).toBeVisible();
      await c.locator(`input[type=radio][value="${deviceA}"]`).check();
      await c.getByRole('button', { name: 'Sign out this device and continue' }).click();
      await expect(c).toHaveURL(tenantUrl(SLUG, '/app'));
      await a.goto(tenantUrl(SLUG, '/app/classes'));
      await expect(a).toHaveURL(/\/login(\?|$)/);
      await b.goto(tenantUrl(SLUG, '/app/classes'));
      await expect(b).toHaveURL(tenantUrl(SLUG, '/app/classes'));
      await owner(page);
      await page.goto(tenantUrl(SLUG, `/admin/students/${session.user.id}?tab=devices`));
      await page
        .getByRole('table')
        .getByRole('button', { name: /^Sign out / })
        .first()
        .click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Sign out', exact: true })
        .click();
      await expect(
        page
          .getByRole('region', { name: 'Notifications' })
          .getByText('Device signed out', { exact: true }),
      ).toBeVisible();
      const results = await Promise.all(
        [b, c].map(async (device) => {
          await device.goto(tenantUrl(SLUG, '/app/classes'));
          return device.url();
        }),
      );
      expect(results.filter((url) => /\/login(\?|$)/.test(url))).toHaveLength(1);
    } finally {
      for (const ctx of contexts) {
        const device = ctx.pages()[0];
        if (device) await apiRequest(device, '/api/v1/auth/logout', 'POST', {});
        await ctx.close();
      }
    }
  });

  test('J-08: map, preview, commit and poll 500 CSV students, with an error file for bad rows', async ({
    page,
  }, info) => {
    await owner(page);
    test.slow(); // Bulk validation, import processing and the table refresh span several requests.
    const before = await apiGet<{ total: number }>(page, '/api/v1/admin/students');
    const marker = randomUUID().slice(0, 8);
    // The total advances by 500 after each successful run, giving retries a fresh phone block.
    const start = before.total;
    const rows = Array.from(
      { length: 500 },
      (_, i) => `CSV ${marker} ${i},076${String(8_000_000 + start + i).padStart(7, '0')}`,
    );
    rows.push('Bad phone,invalid', 'Missing phone,', ',077bad');
    await page.goto(tenantUrl(SLUG, '/admin/students/import'));
    await page.locator('input[type=file]').setInputFiles({
      name: 'students.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(['Full name,Mobile', ...rows].join('\n')),
    });
    await expect(page.getByRole('heading', { name: 'Match your columns' })).toBeVisible();
    await page.getByLabel('Name', { exact: true }).selectOption('0');
    await page.getByLabel('Phone', { exact: true }).selectOption('1');
    const preview = page.waitForResponse(
      (res) => res.url().endsWith('/imports/students/preview') && res.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Check my students' }).click();
    expect((await (await preview).json()).summary).toEqual({
      total: 503,
      ok: 500,
      errors: 3,
      duplicates: 0,
    });
    await expect(page.getByRole('heading', { name: 'Check before you import' })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download rows that need attention' }).click();
    expect((await download).suggestedFilename()).toBe('students-import-needs-attention.csv');
    const commit = page.waitForResponse((res) => res.url().endsWith('/imports/students/commit'), {
      timeout: 30_000,
    });
    let polled = false;
    page.on('response', (res) => {
      if (
        /\/imports\/[^/]+$/.test(new URL(res.url()).pathname) &&
        res.request().method() === 'GET' &&
        res.status() === 200
      )
        polled = true;
    });
    await page.getByRole('button', { name: 'Import 500 students', exact: true }).click();
    expect((await commit).status()).toBe(202);
    await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible();
    await expect(page.getByText('500 students imported.', { exact: true })).toBeVisible();
    expect(polled).toBe(true);
    await page.getByRole('link', { name: 'View students' }).click();
    await expect(page.getByText(new RegExp(`of ${String(before.total + 500)}$`))).toBeVisible();
    expect((await apiGet<{ total: number }>(page, '/api/v1/admin/students')).total).toBe(
      before.total + 500,
    );
  });

  test('staff invite acceptance: owner and cashier require SMS, and trusted computers skip the next code', async ({
    page,
    browser,
  }, info) => {
    await owner(page);
    test.slow(); // Two invitations and six complete sign-in/sign-out flows.
    // Repeated staging demos must not leave test cashiers occupying the plan's seats.
    await retireInviteFixtures(page);
    for (const [index, role] of (['owner', 'cashier'] as const).entries()) {
      const phone = `+9476${String(7_000_000 + projectIndex(info.project.name) * 100_000 + Math.floor(Math.random() * 80_000) + index).padStart(7, '0')}`;
      const name = `Invited ${role} ${randomUUID().slice(0, 8)}`;
      await page.goto(tenantUrl(SLUG, '/admin/settings/staff'));
      await page.getByRole('button', { name: 'Invite someone' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Full name').fill(name);
      await dialog.getByLabel('Role', { exact: true }).selectOption(role);
      await dialog.getByLabel('Phone number').fill(phone);
      const offset = smsOffset();
      const createdInvite = page.waitForResponse(
        (res) => res.url().endsWith('/admin/staff/invites') && res.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: 'Send invitation' }).click();
      expect((await createdInvite).status()).toBe(201);
      const link = await deliveredSms(
        phone,
        offset,
        /(https?:\/\/[^\s]+\/admin\/invite#[A-Za-z0-9_-]+)/,
      );
      const ctx = await browser.newContext({
        ...info.project.use,
        extraHTTPHeaders: {
          'x-forwarded-for': `10.22.${projectIndex(info.project.name)}.${index + 1}`,
        },
      });
      try {
        const invited = await ctx.newPage();
        await invited.goto(link);
        await invited.getByLabel('New password', { exact: true }).fill(PASSWORD);
        await invited.getByRole('button', { name: 'Set password and sign in' }).click();
        await expect(invited).toHaveURL(tenantUrl(SLUG, '/admin'));
        await logout(invited);
        await expect(invited).toHaveURL(tenantUrl(SLUG, '/admin/login'));
        const codeOffset = smsOffset();
        await submitStaffLogin(invited, SLUG, phone, PASSWORD);
        await expect(invited.getByRole('heading', { name: 'Check your phone' })).toBeVisible();
        const code = await deliveredSms(phone, codeOffset, /\b(\d{6})\b/);
        await invited.getByLabel('6-digit code').fill(code);
        await invited.getByLabel('Trust this computer for 30 days', { exact: true }).check();
        await invited.getByRole('button', { name: 'Verify', exact: true }).click();
        await expect(invited).toHaveURL(tenantUrl(SLUG, '/admin'));
        expect((await ctx.cookies()).find((cookie) => cookie.name === 'remix_trust')).toBeDefined();
        await logout(invited);
        await expect(invited).toHaveURL(tenantUrl(SLUG, '/admin/login'));
        const nextLogin = invited.waitForResponse((res) => res.url().endsWith('/auth/staff/login'));
        await submitStaffLogin(invited, SLUG, phone, PASSWORD);
        expect((await nextLogin).status()).toBe(200);
        await expect(invited).toHaveURL(tenantUrl(SLUG, '/admin'));
        await expect(invited.getByRole('heading', { name: 'Check your phone' })).toHaveCount(0);
      } finally {
        try {
          await retireInviteFixtures(page, name);
        } finally {
          await ctx.close();
        }
      }
    }
  });

  test('permissions: teachers see only their classes and students, with no writes', async ({
    page,
  }) => {
    await loginStaff(page, SLUG, '+94770001183', PASSWORD);
    await page.goto(tenantUrl(SLUG, '/admin/classes'));
    const classes = await apiGet<{ items: { id: string; name: string }[] }>(
      page,
      '/api/v1/admin/classes',
    );
    expect(classes.items.map((c) => c.name).sort()).toEqual(
      ['2026 A/L Revision', '2028 A/L Physics Theory', 'Grade 11 O/L Science'].sort(),
    );
    for (const cls of classes.items)
      await expect(page.getByRole('link', { name: cls.name })).toBeVisible();
    await expect(page.getByText('2027 A/L Physics Theory', { exact: true })).toHaveCount(0);
    await page.goto(tenantUrl(SLUG, '/admin/students'));
    const students = await apiGet<{ items: { id: string }[]; total: number }>(
      page,
      '/api/v1/admin/students',
    );
    const visible = new Set<string>();
    for (const cls of classes.items) {
      const roster = await apiGet<{ items: { studentId: string }[] }>(
        page,
        `/api/v1/admin/classes/${cls.id}/students`,
      );
      for (const student of roster.items) visible.add(student.studentId);
    }
    expect(students.total).toBe(visible.size);
    expect(students.items.every((student) => visible.has(student.id))).toBe(true);
    await expectReadOnly(page, 'teacher');
  });

  test('permissions: cashiers have no write controls and write APIs return 403', async ({
    page,
  }) => {
    await loginStaff(page, SLUG, '+94770001182', PASSWORD, '+94770001182');
    await expectReadOnly(page, 'cashier');
  });

  test('TEN-03: theme settings apply colour and logo to admin and portal shells', async ({
    page,
    browser,
  }, info) => {
    await owner(page);
    const previous = await apiGet<{
      brandColor: string | null;
      logoUrl: string | null;
      faviconUrl: string | null;
    }>(page, '/api/v1/admin/settings/theme');
    const logo = 'https://assets.example.test/institute-logo.png';
    const studentCtx = await browser.newContext({ ...info.project.use });
    try {
      await page.goto(tenantUrl(SLUG, '/admin/settings/theme'));
      await page.getByLabel('Colour code').fill('#0f766e');
      await page.getByLabel('Logo address').fill(logo);
      await page.getByRole('button', { name: 'Save theme' }).click();
      await expect(
        page
          .getByRole('region', { name: 'Notifications' })
          .getByText('Theme saved', { exact: true }),
      ).toBeVisible();
      await page.goto(tenantUrl(SLUG, '/admin'));
      await expect(page.locator('img[src="' + logo + '"]:visible')).toHaveAttribute('src', logo);
      expect(
        await page
          .locator('html')
          .evaluate((el) => getComputedStyle(el).getPropertyValue('--color-brand').trim()),
      ).toBe('#0f766e');
      const studentPage = await studentCtx.newPage();
      await loginStudent(
        studentPage,
        SLUG,
        kamalStudentPhone(1511 + projectIndex(info.project.name)),
        PASSWORD,
      );
      await expect(studentPage.locator('img[src="' + logo + '"]:visible')).toHaveAttribute(
        'src',
        logo,
      );
      expect(
        await studentPage
          .locator('html')
          .evaluate((el) => getComputedStyle(el).getPropertyValue('--color-brand').trim()),
      ).toBe('#0f766e');
    } finally {
      const res = await apiRequest(page, '/api/v1/admin/settings/theme', 'PATCH', previous);
      expect(res.status).toBe(200);
      const studentPage = studentCtx.pages()[0];
      if (studentPage) await apiRequest(studentPage, '/api/v1/auth/logout', 'POST', {});
      await studentCtx.close();
    }
  });
});
