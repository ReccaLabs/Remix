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
import { LogoutButton } from './logout-button';
import { StaffLoginForm } from './staff-login-form';
import { StudentLoginForm } from './student-login-form';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/navigate', () => ({ hardNavigate: navigate }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigate.mockReset();
});

function wrap(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ auth, common, errors }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

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

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': status >= 400 ? 'application/problem+json' : 'application/json',
      ...headers,
    },
  });

const problem = (status: number, code: string, headers?: Record<string, string>) =>
  json({ type: 'about:blank', title: code, status, code }, status, headers);

function stubFetch(respond: () => Response | Promise<Response>) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => respond());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function fillStudent(phone = '077 123 4567', password = 'correct-horse') {
  const user = userEvent.setup();
  if (phone) await user.type(screen.getByRole('textbox', { name: 'Phone number' }), phone);
  if (password) await user.type(screen.getByLabelText('Password'), password);
  return user;
}

describe('StudentLoginForm', () => {
  it('shows field errors from the shared schema without calling the API', async () => {
    const fetch = stubFetch(() => json(session));
    wrap(<StudentLoginForm redirectTo="/app" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Enter your phone number.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Phone number' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    // React Hook Form moves focus to the first invalid field.
    expect(screen.getByRole('textbox', { name: 'Phone number' })).toHaveFocus();

    await user.type(screen.getByRole('textbox', { name: 'Phone number' }), '011 234 5678');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(
      await screen.findByText('Enter a Sri Lankan mobile number, for example 077 123 4567.'),
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts the normalised phone same-origin and then loads the target page', async () => {
    const fetch = stubFetch(() => json(session));
    wrap(<StudentLoginForm redirectTo="/app/classes" />);
    const user = await fillStudent();
    await user.click(screen.getByRole('checkbox', { name: 'Stay signed in for 30 days' }));
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app/classes'));
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/v1/auth/student/login');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(JSON.parse(String(init?.body))).toEqual({
      phone: '+94771234567',
      password: 'correct-horse',
      staySignedIn: true,
    });
  });

  it('disables the button while the request is in flight', async () => {
    let release: (res: Response) => void = () => undefined;
    stubFetch(() => new Promise<Response>((resolve) => (release = resolve)));
    wrap(<StudentLoginForm redirectTo="/app" />);
    const user = await fillStudent();
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    const busy = await screen.findByRole('button', { name: 'Logging in…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');

    release(problem(401, 'INVALID_CREDENTIALS'));
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeEnabled();
  });

  it('shows one generic message for wrong credentials', async () => {
    stubFetch(() => problem(401, 'INVALID_CREDENTIALS'));
    wrap(<StudentLoginForm redirectTo="/app" />);
    const user = await fillStudent();
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The phone number or password is wrong. Check them and try again.',
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('uses Retry-After when rate limited', async () => {
    stubFetch(() => problem(429, 'RATE_LIMITED', { 'retry-after': '30' }));
    wrap(<StudentLoginForm redirectTo="/app" />);
    const user = await fillStudent();
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again in 30 seconds.',
    );
  });

  it('explains a network failure', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    wrap(<StudentLoginForm redirectTo="/app" />);
    const user = await fillStudent();
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "We couldn't connect. Check your internet connection and try again.",
    );
  });
});

describe('StaffLoginForm', () => {
  it('posts the identifier and names email in the generic error', async () => {
    const fetch = stubFetch(() => problem(401, 'INVALID_CREDENTIALS'));
    wrap(<StaffLoginForm redirectTo="/admin" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your phone number or email address.')).toBeVisible();

    await user.type(screen.getByRole('textbox', { name: 'Phone or email' }), 'kamal@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret-pass');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The phone, email or password is wrong.',
    );
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/v1/auth/staff/login');
    expect(JSON.parse(String(init?.body))).toEqual({
      identifier: 'kamal@example.com',
      password: 'secret-pass',
      staySignedIn: false,
    });
  });

  it('goes to the admin home on success', async () => {
    stubFetch(() =>
      json({ ...session, user: { ...session.user, kind: 'staff', roles: ['owner'] } }),
    );
    wrap(<StaffLoginForm redirectTo="/admin" />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Phone or email' }), '0712345678');
    await user.type(screen.getByLabelText('Password'), 'secret-pass');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/admin'));
  });
});

describe('LogoutButton', () => {
  it('POSTs {} to logout and loads the login page', async () => {
    const fetch = stubFetch(() => new Response(null, { status: 204 }));
    wrap(<LogoutButton redirectTo="/login" />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login'));
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/v1/auth/logout');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{}');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  });

  it('stays put with a message when the network is down', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    wrap(<LogoutButton redirectTo="/login" />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't log you out.");
    expect(navigate).not.toHaveBeenCalled();
  });
});
