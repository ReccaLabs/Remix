// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { CardPay } from './card-pay';
import { PayOverview } from './pay-overview';
import { FEES, json, wrap } from './test-fixtures';

const CHECKOUT = '0193f1c2-7b1d-7c3e-9a4f-000000000701';
const SIGNED = {
  checkoutId: CHECKOUT,
  actionUrl: 'https://sandbox.payhere.lk/pay/checkout',
  fields: {
    merchant_id: '1211149',
    order_id: CHECKOUT,
    amount: '5000.00',
    currency: 'LKR',
    hash: 'A'.repeat(32),
  },
};

/** jsdom cannot navigate: capture what the auto-submitted form would have posted. */
function captureSubmit() {
  const posted: { action: string; method: string; fields: Record<string, string> }[] = [];
  vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (
    this: HTMLFormElement,
  ) {
    posted.push({
      action: this.action,
      method: this.method,
      fields: Object.fromEntries([...this.querySelectorAll('input')].map((i) => [i.name, i.value])),
    });
  });
  return posted;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('student card payment (FEE-03/04)', () => {
  it('pays the chosen whole months: creates a checkout and posts the signed form to PayHere; axe clean', async () => {
    const fetch = vi.fn(async () => json(SIGNED));
    vi.stubGlobal('fetch', fetch);
    const posted = captureSubmit();
    const { container } = wrap(<CardPay lines={FEES.openLines} />);
    await expectNoAxeViolations(container);
    const [first, second] = FEES.openLines;
    // Untick the second month: the total and the request follow the choice.
    await userEvent.click(screen.getAllByRole('checkbox')[1]!);
    await userEvent.click(screen.getByRole('button', { name: 'Pay LKR 2,500.00 by card' }));
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('/api/v1/me/payments/checkout');
    expect(JSON.parse(String(calls[0]?.[1].body))).toEqual({ lineIds: [first!.id] });
    expect(second).toBeDefined();
    expect(posted).toEqual([{ action: SIGNED.actionUrl, method: 'post', fields: SIGNED.fields }]);
    expect(document.querySelector('form[action^="https://"]')).toBeNull();
  });

  it('never posts to anything but the PayHere gateways', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ ...SIGNED, actionUrl: 'https://evil.example.test/collect' })),
    );
    const posted = captureSubmit();
    wrap(<CardPay lines={FEES.openLines} />);
    await userEvent.click(screen.getByRole('button', { name: /by card/ }));
    expect(posted).toHaveLength(0);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not start the payment');
  });

  it('explains paid months, disabled card payments and rate limits', async () => {
    for (const [code, status, text] of [
      ['ALREADY_PAID', 409, 'already paid'],
      ['PAYMENT_PROVIDER_UNAVAILABLE', 409, 'not available right now'],
      ['RATE_LIMITED', 429, 'Too many attempts'],
    ] as const) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => json({ type: 'about:blank', title: 'x', code, status }, status)),
      );
      const posted = captureSubmit();
      wrap(<CardPay lines={FEES.openLines} />);
      await userEvent.click(screen.getByRole('button', { name: /by card/ }));
      expect(await screen.findByRole('alert')).toHaveTextContent(text);
      expect(posted).toHaveLength(0);
      cleanup();
      vi.restoreAllMocks();
    }
  });

  it('cannot pay without a month and is hidden when the institute has not enabled cards', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    wrap(<CardPay lines={FEES.openLines} />);
    for (const box of screen.getAllByRole('checkbox')) await userEvent.click(box);
    expect(screen.getByRole('button', { name: /by card/ })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
    cleanup();
    const fees = { openLines: FEES.openLines, payments: [], slips: [], bankDetails: null };
    wrap(<PayOverview fees={{ ...fees, cardEnabled: false }} />);
    expect(screen.queryByRole('region', { name: 'Pay by card' })).toBeNull();
    cleanup();
    wrap(<PayOverview fees={{ ...fees, cardEnabled: true }} />);
    expect(screen.getByRole('region', { name: 'Pay by card' })).toBeInTheDocument();
  });
});
