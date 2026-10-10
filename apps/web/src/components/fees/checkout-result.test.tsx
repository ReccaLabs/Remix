// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { checkoutParam } from '@/lib/checkout-param';
import { CheckoutResult, POLL_ATTEMPTS, POLL_INTERVAL_MS } from './checkout-result';
import { json, wrap } from './test-fixtures';

const CHECKOUT = '0193f1c2-7b1d-7c3e-9a4f-000000000701';
const RECEIPT = '0193f1c2-7b1d-7c3e-9a4f-000000000900';
const state = (status: string, receiptId: string | null = null) =>
  json({ checkoutId: CHECKOUT, status, receiptId });

/** Let pending fetches and React updates settle, then move the poll timer on. */
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('card payment return page (FEE-04)', () => {
  it('polls the API until PayHere’s confirmation arrives, then offers the receipt; axe clean', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(state('pending'))
      .mockResolvedValueOnce(state('pending'))
      .mockResolvedValue(state('paid', RECEIPT));
    vi.stubGlobal('fetch', fetch);
    const { container } = wrap(<CheckoutResult checkoutId={CHECKOUT} />);
    await tick();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for PayHere');
    expect(screen.getByText('Checking your payment with PayHere…')).toBeInTheDocument();
    await tick(POLL_INTERVAL_MS);
    await tick(POLL_INTERVAL_MS);
    expect(screen.getByRole('status')).toHaveTextContent('Payment received');
    expect(screen.getByRole('button', { name: 'Download receipt' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String((fetch.mock.calls as unknown as [string][])[0]?.[0])).toBe(
      `/api/v1/me/payments/checkout/${CHECKOUT}`,
    );
    // Settled: no further polling.
    await tick(POLL_INTERVAL_MS * 3);
    expect(fetch).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
    await expectNoAxeViolations(container);
  });

  it('shows failed, cancelled and expired orders in words', async () => {
    for (const [status, word] of [
      ['failed', 'Payment failed'],
      ['cancelled', 'Payment cancelled'],
      ['expired', 'Payment not completed'],
    ] as const) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => state(status)),
      );
      wrap(<CheckoutResult checkoutId={CHECKOUT} />);
      await tick();
      expect(screen.getByRole('status')).toHaveTextContent(word);
      expect(screen.queryByRole('button', { name: 'Download receipt' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Back to Pay' })).toHaveAttribute('href', '/app/pay');
      cleanup();
    }
  });

  it('stops after the polling budget and lets the student check again', async () => {
    const fetch = vi.fn(async () => state('pending'));
    vi.stubGlobal('fetch', fetch);
    wrap(<CheckoutResult checkoutId={CHECKOUT} />);
    for (let i = 0; i < POLL_ATTEMPTS + 2; i += 1) await tick(POLL_INTERVAL_MS);
    expect(fetch).toHaveBeenCalledTimes(POLL_ATTEMPTS);
    expect(screen.getByText(/has not confirmed this payment yet/)).toBeInTheDocument();
    fetch.mockImplementation(async () => state('paid', RECEIPT));
    await act(async () => {
      screen.getByRole('button', { name: 'Check again' }).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Payment received');
  });

  it('says "not found" for a missing, foreign or malformed order id without calling the API', async () => {
    const fetch = vi.fn(async () =>
      json(
        { type: 'about:blank', title: 'Payment not found', code: 'NOT_FOUND', status: 404 },
        404,
      ),
    );
    vi.stubGlobal('fetch', fetch);
    wrap(<CheckoutResult checkoutId={CHECKOUT} />);
    await tick();
    expect(screen.getByRole('alert')).toHaveTextContent('could not find this payment');
    cleanup();
    fetch.mockClear();
    wrap(<CheckoutResult checkoutId={null} />);
    await tick();
    expect(screen.getByRole('alert')).toHaveTextContent('could not find this payment');
    expect(fetch).not.toHaveBeenCalled();
    expect(checkoutParam(CHECKOUT)).toBe(CHECKOUT);
    for (const bad of [undefined, 'x', [CHECKOUT, CHECKOUT], `${CHECKOUT}/../x`])
      expect(checkoutParam(bad)).toBeNull();
  });
});
