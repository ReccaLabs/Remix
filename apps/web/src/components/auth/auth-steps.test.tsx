// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import auth from '../../../messages/en/auth.json';
import common from '../../../messages/en/common.json';
import errors from '../../../messages/en/errors.json';
import { expectNoAxeViolations } from '../../../test/axe';
import { CodeFlow } from './code-flow';
import { InviteAcceptance } from './invite-acceptance';
import { StaffLoginForm } from './staff-login-form';
import { StudentLoginForm } from './student-login-form';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/navigate', () => ({ hardNavigate: navigate }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigate.mockReset();
  window.history.replaceState(null, '', '/');
});

function wrap(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" timeZone="Asia/Colombo" messages={{ auth, common, errors }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const TOKEN = 'T'.repeat(43);
const session = {
  user: {
    id: '0193f1c2-7b1d-7c3e-9a4f-111111111111',
    tenantId: '0193f1c2-7b1d-7c3e-9a4f-000000000000',
    kind: 'student',
    displayName: 'Sample Student',
    roles: [],
    locale: 'en',
  },
  expiresAt: '2026-11-01T00:00:00.000Z',
  impersonated: false,
};

const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      'content-type': status >= 400 ? 'application/problem+json' : 'application/json',
    },
  });
const problem = (status: number, code: string, extra: object = {}) =>
  json({ type: 'about:blank', title: code, status, code, ...extra }, status);

/** Answers each call by path; records method, path and parsed body. */
function stubApi(routes: Record<string, () => Response>) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const path = new URL(String(input), 'http://x').pathname;
    calls.push({
      path,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const route = routes[path];
    return route ? route() : problem(404, 'NOT_FOUND');
  });
  vi.stubGlobal('fetch', fetch);
  return calls;
}

describe('AUTH-03 device limit (Student Login 1c)', () => {
  const challenge = {
    token: TOKEN,
    expiresAt: '2026-10-15T04:35:00.000Z',
    devices: [
      {
        id: '0193f1c2-7b1d-7c3e-9a4f-aaaaaaaaaaaa',
        label: 'Chrome on Windows',
        firstSeenAt: '2026-10-01T04:30:00.000Z',
        lastSeenAt: '2026-10-14T16:10:00.000Z',
      },
      {
        id: '0193f1c2-7b1d-7c3e-9a4f-bbbbbbbbbbbb',
        label: 'Chrome on Android',
        firstSeenAt: '2026-10-02T04:30:00.000Z',
        lastSeenAt: '2026-10-15T01:42:00.000Z',
      },
    ],
  };

  it('shows the device chooser and finishes the login on the chosen device', async () => {
    const calls = stubApi({
      '/api/v1/auth/student/login': () => problem(403, 'DEVICE_LIMIT', { challenge }),
      '/api/v1/auth/student/device-limit': () => json(session),
    });
    const { container } = wrap(<StudentLoginForm redirectTo="/app" />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Phone number' }), '0771234567');
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(
      await screen.findByRole('heading', { name: "You're signed in on 2 devices" }),
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);

    await user.click(screen.getByRole('button', { name: 'Sign out this device and continue' }));
    expect(await screen.findByText('Choose a device to sign out.')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Chrome on Windows/ }));
    await user.click(screen.getByRole('button', { name: 'Sign out this device and continue' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app'));
    expect(calls.at(-1)).toEqual({
      path: '/api/v1/auth/student/device-limit',
      method: 'POST',
      body: { token: TOKEN, signOutDeviceId: challenge.devices[0]?.id },
    });
  });

  it('an expired ticket asks to start again; Cancel returns to the form', async () => {
    stubApi({
      '/api/v1/auth/student/login': () => problem(403, 'DEVICE_LIMIT', { challenge }),
      '/api/v1/auth/student/device-limit': () => problem(400, 'CODE_INVALID'),
    });
    wrap(<StudentLoginForm redirectTo="/app" />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Phone number' }), '0771234567');
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await user.click(await screen.findByRole('radio', { name: /Chrome on Android/ }));
    await user.click(screen.getByRole('button', { name: 'Sign out this device and continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/took too long/);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a locked account links to the SMS unlock', async () => {
    stubApi({ '/api/v1/auth/student/login': () => problem(423, 'ACCOUNT_LOCKED') });
    wrap(<StudentLoginForm redirectTo="/app" />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Phone number' }), '0771234567');
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    const link = await screen.findByRole('link', { name: 'Unlock it with an SMS code' });
    expect(link).toHaveAttribute('href', '/login/unlock');
  });
});

describe('AUTH-05 staff two-step (Staff Login 15b/15d)', () => {
  const challenge = {
    token: TOKEN,
    maskedPhone: '+94 77 *** **80',
    resendAfterSeconds: 45,
    expiresAt: '2026-10-15T04:40:00.000Z',
  };

  async function toCodeStep(routes: Record<string, () => Response>) {
    const calls = stubApi({
      '/api/v1/auth/staff/login': () => problem(401, 'TWO_STEP_REQUIRED', { challenge }),
      ...routes,
    });
    const view = wrap(<StaffLoginForm redirectTo="/admin" />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Phone or email' }), 'owner@example.test');
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: 'Check your phone' });
    return { calls, user, view };
  }

  it('asks for the code with the masked number, a resend timer and "trust this computer"', async () => {
    const { calls, user, view } = await toCodeStep({
      '/api/v1/auth/staff/two-step': () => json({ ...session, user: { ...session.user, kind: 'staff', roles: ['owner'] } }),
    });
    expect(screen.getByText(/We sent it to \+94 77 \*\*\* \*\*80\./)).toBeInTheDocument();
    expect(screen.getByText(/Resend in 0:4\d/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send a new code' })).toBeNull();
    await expectNoAxeViolations(view.container);

    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('Enter the 6 digits from the SMS.')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '6-digit code' }), '391 204');
    await user.click(screen.getByRole('checkbox', { name: /Trust this computer for 30 days/ }));
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/admin'));
    expect(calls.at(-1)).toEqual({
      path: '/api/v1/auth/staff/two-step',
      method: 'POST',
      body: { token: TOKEN, code: '391204', trustDevice: true },
    });
  });

  it('shows a wrong code as one message and stays on the step', async () => {
    const { user } = await toCodeStep({
      '/api/v1/auth/staff/two-step': () => problem(400, 'CODE_INVALID'),
    });
    await user.type(screen.getByRole('textbox', { name: '6-digit code' }), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code is wrong or has expired.',
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a 2-step role without a mobile number gets its own message', async () => {
    stubApi({ '/api/v1/auth/staff/login': () => problem(403, 'FORBIDDEN') });
    wrap(<StaffLoginForm redirectTo="/admin" />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Phone or email' }), 'owner@example.test');
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/needs a mobile number/);
  });
});

describe('AUTH-02/07/09 SMS-code flow (Student Login 1b)', () => {
  it('phone → code → new password → done, never saying whether the phone exists', async () => {
    const calls = stubApi({
      '/api/v1/auth/otp/request': () => json({ resendAfterSeconds: 45 }, 202),
      '/api/v1/auth/otp/verify': () => json({ ticket: TOKEN }),
      '/api/v1/auth/password/set': () => json(undefined, 204),
    });
    const { container } = wrap(
      <CodeFlow purpose="password_reset" who="student" loginHref="/login" />,
    );
    const user = userEvent.setup();
    await expectNoAxeViolations(container);

    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText('Enter your phone number.')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Phone number' }), '077 123 4567');
    await user.click(screen.getByRole('button', { name: 'Send code' }));

    expect(await screen.findByRole('heading', { name: 'Enter the code' })).toBeInTheDocument();
    expect(screen.getByText(/If \+94771234567 has an account here/)).toBeInTheDocument();
    expect(screen.getByText(/Resend in 0:4\d/)).toBeInTheDocument();
    await expectNoAxeViolations(container);

    await user.type(screen.getByRole('textbox', { name: '6-digit code' }), '482015');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByText('Use at least 8 characters.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('New password'));
    await user.type(screen.getByLabelText('New password'), 'a long new passphrase');
    await user.click(screen.getByRole('button', { name: 'Save password' }));

    expect(await screen.findByRole('heading', { name: 'Password saved' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to login' })).toHaveAttribute('href', '/login');
    await expectNoAxeViolations(container);
    expect(calls.map((c) => [c.path, c.body])).toEqual([
      ['/api/v1/auth/otp/request', { phone: '+94771234567', purpose: 'password_reset' }],
      [
        '/api/v1/auth/otp/verify',
        { phone: '+94771234567', purpose: 'password_reset', code: '482015' },
      ],
      ['/api/v1/auth/password/set', { ticket: TOKEN, newPassword: 'a long new passphrase' }],
    ]);
  });

  it('unlock skips the password step; a new code can be sent once the timer is done', async () => {
    const calls = stubApi({
      '/api/v1/auth/otp/request': () => json({ resendAfterSeconds: 0 }, 202),
      '/api/v1/auth/otp/verify': () => json({ ticket: null }),
    });
    wrap(<CodeFlow purpose="unlock" who="staff" loginHref="/admin/login" />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Phone number' }), '0771234567');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.click(await screen.findByRole('button', { name: 'Send a new code' }));
    await waitFor(() => expect(calls.filter((c) => c.path.endsWith('/request'))).toHaveLength(2));
    await user.type(screen.getByRole('textbox', { name: '6-digit code' }), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('heading', { name: 'Account unlocked' })).toBeInTheDocument();
  });

  it('maps a wrong code, a common password and an expired ticket', async () => {
    let verify = () => problem(400, 'CODE_INVALID');
    let set = () =>
      problem(400, 'VALIDATION_FAILED', {
        errors: [{ path: 'newPassword', message: 'This password is too common' }],
      });
    stubApi({
      '/api/v1/auth/otp/request': () => json({ resendAfterSeconds: 45 }, 202),
      '/api/v1/auth/otp/verify': () => verify(),
      '/api/v1/auth/password/set': () => set(),
    });
    wrap(<CodeFlow purpose="first_password" who="student" loginHref="/login" />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Phone number' }), '0771234567');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByRole('textbox', { name: '6-digit code' }), '111111');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is wrong or has expired.');

    verify = () => json({ ticket: TOKEN });
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await user.type(await screen.findByLabelText('New password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That password is too common.');

    set = () => problem(400, 'CODE_INVALID');
    await user.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/took too long/);
    await user.click(screen.getByRole('button', { name: 'Start again' }));
    expect(screen.getByRole('button', { name: 'Send code' })).toBeInTheDocument();
  });
});

describe('AUTH-07 invitation (/admin/invite#token)', () => {
  const preview = {
    tenantName: 'Kamal Physics',
    displayName: 'Dilani Fernando',
    role: 'cashier',
    expiresAt: '2026-10-18T04:30:00.000Z',
  };

  it('reads the token from the fragment, removes it from the URL, previews and accepts', async () => {
    window.history.replaceState(null, '', `/admin/invite#${TOKEN}`);
    const calls = stubApi({
      '/api/v1/auth/invite/preview': () => json(preview),
      '/api/v1/auth/invite/accept': () =>
        json({ ...session, user: { ...session.user, kind: 'staff', roles: ['cashier'] } }),
    });
    const { container } = wrap(<InviteAcceptance redirectTo="/admin" />);
    expect(await screen.findByRole('heading', { name: 'Join Kamal Physics' })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(TOKEN);
    expect(screen.getByText(/invited as cashier/)).toBeInTheDocument();
    await expectNoAxeViolations(container);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('New password'), 'a cashier passphrase');
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/admin'));
    // The token only ever travels in POST bodies, never in a URL.
    for (const call of calls) {
      expect(call.method).toBe('POST');
      expect(call.path).not.toContain(TOKEN);
    }
    expect(calls.map((c) => c.body)).toEqual([
      { token: TOKEN },
      { token: TOKEN, newPassword: 'a cashier passphrase' },
    ]);
  });

  it('a missing or spent token shows the invalid state', async () => {
    const calls = stubApi({});
    wrap(<InviteAcceptance redirectTo="/admin" />);
    expect(
      await screen.findByRole('heading', { name: "This invitation link doesn't work" }),
    ).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    cleanup();
    window.history.replaceState(null, '', `/admin/invite#${TOKEN}`);
    stubApi({ '/api/v1/auth/invite/preview': () => problem(400, 'INVITE_INVALID') });
    wrap(<InviteAcceptance redirectTo="/admin" />);
    expect(
      await screen.findByRole('heading', { name: "This invitation link doesn't work" }),
    ).toBeInTheDocument();
  });
});
