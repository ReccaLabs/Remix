// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { ToastProvider } from '@remix/ui';
import type { SmsWallet } from '@remix/types/api';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import settings from '../../../messages/en/settings.json';
import { expectNoAxeViolations } from '../../../test/axe';
import { SmsWalletCard } from './sms-wallet-card';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  router.refresh.mockClear();
});

const WALLET: SmsWallet = {
  balanceCents: 123_450,
  senderId: null,
  lowBalanceThresholdCents: 20_000,
  lowBalance: false,
  openTopUpRequests: 0,
  segmentPriceCents: 95,
  recent: [
    { id: '0193f1c2-7b1d-7c3e-9a4f-000000000a01', kind: 'top_up', amountCents: 200_000, balanceAfterCents: 200_000, note: 'Invoice 42 paid', at: '2026-10-01T04:30:00Z' },
    { id: '0193f1c2-7b1d-7c3e-9a4f-000000000a02', kind: 'send', amountCents: -95, balanceAfterCents: 199_905, note: null, at: '2026-10-02T04:30:00Z' },
  ],
};
const json = (body: unknown, status = 200) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' } });
function wrap(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" timeZone="Asia/Colombo" messages={{ settings }}>
      <ToastProvider dismissLabel="Dismiss" regionLabel="Notifications">{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe('MSG-02 SMS wallet card', () => {
  it('shows balance, sender, price and ledger entries as words and signed amounts; axe clean', async () => {
    const { container } = wrap(<SmsWalletCard initial={WALLET} />);
    expect(screen.getByText('LKR 1,234.50')).toBeInTheDocument();
    expect(screen.getByText('Balance is fine')).toBeInTheDocument();
    expect(screen.getByText('ReMix (shared sender)')).toBeInTheDocument();
    expect(screen.getByText('+LKR 2,000.00')).toBeInTheDocument();
    expect(screen.getByText('−LKR 0.95')).toBeInTheDocument();
    expect(screen.getByText('Top-up')).toBeInTheDocument();
    expect(screen.getByText('Message sent')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('warns in words when the balance is low and shows a registered sender name', async () => {
    const { container } = wrap(<SmsWalletCard initial={{ ...WALLET, balanceCents: 500, lowBalance: true, senderId: 'KamalPhys', openTopUpRequests: 2 }} />);
    expect(screen.getByText('Low balance')).toBeInTheDocument();
    expect(screen.getByText(/top up soon/)).toBeInTheDocument();
    expect(screen.getByText('KamalPhys')).toBeInTheDocument();
    expect(screen.getByText('2 requests are waiting for ReMix')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('shows an empty ledger state', () => {
    wrap(<SmsWalletCard initial={{ ...WALLET, recent: [] }} />);
    expect(screen.getByText(/No activity yet/)).toBeInTheDocument();
  });

  it('files a top-up request in cents and refreshes; rejects bad amounts locally', async () => {
    const fetch = vi.fn(async () => json(undefined, 204));
    vi.stubGlobal('fetch', fetch);
    wrap(<SmsWalletCard initial={WALLET} />);
    const submit = screen.getByRole('button', { name: 'Request top-up' });
    await userEvent.type(screen.getByLabelText('Amount (LKR)'), '500');
    await userEvent.click(submit);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText(settings.errors.validation)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Amount (LKR)'));
    await userEvent.type(screen.getByLabelText('Amount (LKR)'), '2000.50');
    await userEvent.click(submit);
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    const [url, init] = (fetch.mock.calls as unknown as [string, RequestInit][])[0]!;
    expect(url).toBe('/api/v1/admin/sms/wallet/top-up');
    expect(JSON.parse(String(init.body))).toEqual({ amountCents: 200_050 });
  });

  it('explains when too many requests are already waiting', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ type: 'about:blank', title: 'Conflict', status: 409, code: 'CONFLICT' }, 409)));
    wrap(<SmsWalletCard initial={WALLET} />);
    await userEvent.type(screen.getByLabelText('Amount (LKR)'), '2000');
    await userEvent.click(screen.getByRole('button', { name: 'Request top-up' }));
    expect(await screen.findByText(/already have requests waiting/)).toBeInTheDocument();
  });
});
