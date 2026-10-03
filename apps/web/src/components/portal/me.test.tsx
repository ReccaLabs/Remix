// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import auth from '../../../messages/en/auth.json';
import errors from '../../../messages/en/errors.json';
import portal from '../../../messages/en/portal.json';
import { expectNoAxeViolations } from '../../../test/axe';
import { ChangePasswordForm } from './change-password-form';
import { LanguagePicker } from './language-picker';
import { MeDevices } from './me-devices';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function wrap(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ auth, errors, portal }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const problem = (status: number, code: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title: code, status, code }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

function stubFetch(respond: () => Response) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => respond());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const devices = [
  {
    id: '0193f1c2-7b1d-7c3e-9a4f-aaaaaaaaaaaa',
    label: 'Chrome on Android',
    firstSeenAt: '2026-10-01T04:30:00.000Z',
    lastSeenAt: '2026-10-15T01:42:00.000Z',
    current: true,
  },
  {
    id: '0193f1c2-7b1d-7c3e-9a4f-bbbbbbbbbbbb',
    label: 'Chrome on Windows',
    firstSeenAt: '2026-10-02T04:30:00.000Z',
    lastSeenAt: '2026-10-14T16:10:00.000Z',
    current: false,
  },
];

describe('MeDevices (AUTH-04)', () => {
  it('marks this device, signs another one out and says so', async () => {
    const fetch = stubFetch(() => new Response(null, { status: 204 }));
    const { container } = wrap(<MeDevices initial={devices} limit={2} />);
    expect(screen.getByText('2 of 2 used')).toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(within(list).getByText('This device')).toBeInTheDocument();
    await expectNoAxeViolations(container);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign out Chrome on Windows' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Chrome on Windows was signed out.');
    expect(screen.queryByText('Chrome on Windows', { selector: 'span' })).toBeNull();
    expect(screen.getByText('1 of 2 used')).toBeInTheDocument();
    expect(screen.getByText('No other devices are signed in.')).toBeInTheDocument();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe(`/api/v1/me/devices/${devices[1]?.id}`);
    expect(init?.method).toBe('DELETE');
  });

  it('keeps the device and shows an error when sign-out fails', async () => {
    stubFetch(() => problem(500, 'INTERNAL'));
    wrap(<MeDevices initial={devices} limit={2} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out Chrome on Windows' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't sign that device out.");
    expect(screen.getByText('2 of 2 used')).toBeInTheDocument();
  });
});

describe('ChangePasswordForm (AUTH-04)', () => {
  it('validates, maps a wrong current password to its field, and confirms success', async () => {
    let respond = () => problem(400, 'INVALID_CREDENTIALS');
    const fetch = stubFetch(() => respond());
    const { container } = wrap(<ChangePasswordForm />);
    await expectNoAxeViolations(container);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Current password'), 'old password');
    await user.type(screen.getByLabelText('New password'), 'a brand new passphrase');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Your current password is wrong.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true');

    respond = () => new Response(null, { status: 204 });
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Password changed. Your other devices were signed out.',
    );
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });
});

describe('LanguagePicker (AUTH-04)', () => {
  it('saves the choice to the account and rolls back on failure', async () => {
    let respond = () => new Response(null, { status: 204 });
    const fetch = stubFetch(() => respond());
    const { container } = wrap(<LanguagePicker initial="en" />);
    await expectNoAxeViolations(container);
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked();
    const user = userEvent.setup();

    await user.click(screen.getByRole('radio', { name: 'සිංහල' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Language saved.');
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ locale: 'si' });
    expect(screen.getByRole('radio', { name: 'සිංහල' })).toBeChecked();

    respond = () => problem(500, 'INTERNAL');
    await user.click(screen.getByRole('radio', { name: 'தமிழ்' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('radio', { name: 'සිංහල' })).toBeChecked());
  });
});
