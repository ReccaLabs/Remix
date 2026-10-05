// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { PayOverview } from './pay-overview';
import { PAYMENT, FEES, json, wrap } from './test-fixtures';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('student Pay history 6f/6g (FEE-10)', () => {
  it('shows mobile cards/desktop table, words for reversals, read-only months and bank details; axe clean', async () => {
    const reversed = { ...PAYMENT, reversedByPaymentId: PAYMENT.id };
    const reversal = { ...PAYMENT, id: '0193f1c2-7b1d-7c3e-9a4f-000000000905', method: 'reversal' as const, amountCents: -500000, reversesPaymentId: PAYMENT.id, receiptId: null };
    const { container } = wrap(<PayOverview fees={{ openLines: FEES.openLines, payments: [reversed, reversal], slips: [], cardEnabled: true, bankDetails: { bankName: 'Sample Bank', branch: 'Colombo', accountName: 'Sample Institute', accountNumber: '123456789' } }} />);
    expect(within(screen.getByRole('region', { name: 'Total' })).getByText('LKR 5,000.00')).toBeInTheDocument();
    expect(screen.getAllByText('Reversed')).toHaveLength(2); expect(screen.getAllByText('Reversal entry')).toHaveLength(2);
    expect(screen.getByText('Sample Bank')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByRole('button', { name: /Pay now|Checkout/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Reprint/ })).toBeNull();
    await expectNoAxeViolations(container);
  });
  it('requests only the receipt signed URL and explains the pending-PDF response', async () => {
    const fetch = vi.fn(async () => json({ type: 'about:blank', title: 'Receipt pending', code: 'CONFLICT', status: 409 }, 409)); vi.stubGlobal('fetch', fetch);
    wrap(<PayOverview fees={{ openLines: [], payments: [PAYMENT], slips: [], cardEnabled: false, bankDetails: null }} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Download receipt' })[0]!);
    expect(await screen.findByRole('alert')).toHaveTextContent('PDF is being prepared');
    expect(String((fetch.mock.calls as unknown as [string][])[0]?.[0])).toBe(`/api/v1/receipts/${PAYMENT.receiptId}/pdf`);
  });
  it('shows an honest empty history and settled months', () => {
    wrap(<PayOverview fees={{ openLines: [], payments: [], slips: [], cardEnabled: false, bankDetails: null }} />);
    expect(screen.getByText('All months are paid')).toBeInTheDocument(); expect(screen.getByText('No payments yet')).toBeInTheDocument();
  });
});
