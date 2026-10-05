// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { ToastProvider } from '@remix/ui';
import type { FeeSettings, PayhereSettings } from '@remix/types/api';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import settings from '../../../messages/en/settings.json';
import { expectNoAxeViolations } from '../../../test/axe';
import { PaymentsForm } from './payments-form';
import { FeeSettingsForm } from './fee-settings-form';
import { submitPayhereForm } from '@/lib/payhere-form';
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  router.refresh.mockClear();
});
const PAYHERE: PayhereSettings = {
  enabled: false,
  mode: 'sandbox',
  merchantId: '1211234',
  secretHint: '••••a1b2',
  lastTest: null,
};
const FEES: FeeSettings = {
  dueDay: 5,
  remindersEnabled: false,
  remindBeforeDays: 0,
  remindAfterDays: 1,
  bankDetails: null,
  receipt: { address: null, phone: null, footer: null },
};
const CHECKOUT = {
  checkoutId: '0193f1c2-7b1d-7c3e-9a4f-000000000999',
  actionUrl: 'https://sandbox.payhere.lk/pay/checkout',
  fields: { order_id: 'test', amount: '10.00', currency: 'LKR', hash: 'A'.repeat(32) },
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
function wrap(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" timeZone="Asia/Colombo" messages={{ settings }}>
      <ToastProvider dismissLabel="Dismiss" regionLabel="Notifications">
        {ui}
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}
describe('SET-02 Payments settings', () => {
  it('is axe-clean, keeps the secret input blank, and omits it on an ordinary save', async () => {
    const fetch = vi.fn(async () => json(PAYHERE));
    vi.stubGlobal('fetch', fetch);
    const { container } = wrap(<PaymentsForm initial={PAYHERE} />);
    await expectNoAxeViolations(container);
    expect(screen.getByLabelText('Merchant secret')).toHaveValue('');
    expect(screen.getByText(/Stored: ••••a1b2/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save payment settings' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    const request = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(String(request[0]![1].body))).not.toHaveProperty('merchantSecret');
  });
  it('writes then clears a newly entered secret and safely auto-submits the returned checkout', async () => {
    const fetch = vi.fn(async (input: unknown) =>
      json(String(input).endsWith('/test') ? CHECKOUT : PAYHERE),
    );
    vi.stubGlobal('fetch', fetch);
    const submitted: { action: string; fields: Record<string, string> }[] = [];
    vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (
      this: HTMLFormElement,
    ) {
      submitted.push({
        action: this.action,
        fields: Object.fromEntries(new FormData(this).entries()) as Record<string, string>,
      });
    });
    wrap(<PaymentsForm initial={PAYHERE} />);
    await userEvent.type(screen.getByLabelText('Merchant secret'), 'sample-secret-a1b2');
    await userEvent.click(screen.getByRole('button', { name: 'Save payment settings' }));
    await waitFor(() => expect(screen.getByLabelText('Merchant secret')).toHaveValue(''));
    await userEvent.click(screen.getByRole('button', { name: 'Test payment (LKR 10)' }));
    await waitFor(() =>
      expect(submitted).toEqual([{ action: CHECKOUT.actionUrl, fields: CHECKOUT.fields }]),
    );
  });
  it('reports API failures and never submits to an arbitrary gateway', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({ type: 'about:blank', title: 'Forbidden', code: 'FORBIDDEN', status: 403 }, 403),
      ),
    );
    wrap(<PaymentsForm initial={PAYHERE} />);
    await userEvent.click(screen.getByRole('button', { name: 'Test payment (LKR 10)' }));
    expect(await screen.findByText(settings.errors.forbidden)).toBeInTheDocument();
    expect(() =>
      submitPayhereForm({ ...CHECKOUT, actionUrl: 'https://evil.example/pay' }),
    ).toThrow();
  });
});
describe('SET-03 Fees settings', () => {
  it('is axe-clean, shows bank fields only when enabled, and saves reminder and template values', async () => {
    const fetch = vi.fn(async () => json(FEES));
    vi.stubGlobal('fetch', fetch);
    const { container } = wrap(<FeeSettingsForm initial={FEES} />);
    await expectNoAxeViolations(container);
    await userEvent.click(screen.getByLabelText('Show bank details to students'));
    for (const [label, value] of [
      ['Bank name', 'Sample Bank'],
      ['Branch', 'Colombo'],
      ['Account number', '123456'],
      ['Account name', 'Sample Institute'],
    ])
      await userEvent.type(screen.getByLabelText(label!), value!);
    await userEvent.type(screen.getByLabelText('Receipt footer'), 'Thank you');
    await userEvent.click(screen.getByLabelText('Enable fee reminders'));
    await expectNoAxeViolations(container);
    await userEvent.click(screen.getByRole('button', { name: 'Save fee settings' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    const request = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(String(request[0]![1].body))).toMatchObject({
      remindersEnabled: true,
      bankDetails: { accountNumber: '123456' },
      receipt: { footer: 'Thank you' },
    });
  });
  it('rejects invalid bounds locally and clears bank/template values with null', async () => {
    const fetch = vi.fn(async () => json(FEES));
    vi.stubGlobal('fetch', fetch);
    wrap(<FeeSettingsForm initial={FEES} />);
    await userEvent.clear(screen.getByLabelText('Due day'));
    await userEvent.type(screen.getByLabelText('Due day'), '29');
    await userEvent.click(screen.getByRole('button', { name: 'Save fee settings' }));
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText(settings.errors.validation)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Due day'));
    await userEvent.type(screen.getByLabelText('Due day'), '28');
    await userEvent.click(screen.getByRole('button', { name: 'Save fee settings' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const request = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(String(request[0]![1].body))).toMatchObject({
      bankDetails: null,
      receipt: { address: null, phone: null, footer: null },
    });
  });
});
