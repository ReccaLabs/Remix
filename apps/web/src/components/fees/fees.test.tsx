// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { Payment } from '@remix/types/api';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fees from '../../../messages/en/fees.json';
import { expectNoAxeViolations } from '../../../test/axe';
import { PaymentsPanel } from './payments-panel';
import { paymentsHref, paymentsQuery } from '@/lib/fees-query';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); router.refresh.mockClear(); });
export const ID = '0193f1c2-7b1d-7c3e-9a4f-000000000901';
export const PAYMENT: Payment = { id: ID, method: 'cash', amountCents: 500000, unallocatedCents: 0, needsRefund: false,
  studentId: '0193f1c2-7b1d-7c3e-9a4f-000000000101', studentName: 'Sample Student', receivedAt: '2026-10-15T04:30:00Z', receivedByName: 'Sample Cashier', reference: null, note: null,
  reversedByPaymentId: null, reversesPaymentId: null, receiptId: '0193f1c2-7b1d-7c3e-9a4f-000000000900', receiptNumber: 'TT-R-26-00001',
  lines: [{ lineId: '0193f1c2-7b1d-7c3e-9a4f-000000000801', className: 'Physics', month: '2026-09-01', amountCents: 250000 }, { lineId: '0193f1c2-7b1d-7c3e-9a4f-000000000802', className: 'Physics', month: '2026-10-01', amountCents: 250000 }] };
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' } });
export function wrap(ui: ReactNode) { return render(<NextIntlClientProvider locale="en" timeZone="Asia/Colombo" messages={{ fees }}>{ui}</NextIntlClientProvider>); }
describe('admin Payments (FEE-07/FEE-10)', () => {
  it('shows states as words, paginates and has only the allowed filter fields; axe clean', async () => {
    const reversed = { ...PAYMENT, id: '0193f1c2-7b1d-7c3e-9a4f-000000000902', reversedByPaymentId: ID };
    const reversal = { ...PAYMENT, id: '0193f1c2-7b1d-7c3e-9a4f-000000000903', method: 'reversal' as const, amountCents: -500000, reversesPaymentId: ID, receiptId: null };
    const { container } = wrap(<PaymentsPanel initial={{ page: 1, pageSize: 25, total: 30, items: [PAYMENT, reversed, reversal] }} query={{}} owner={false} />);
    expect(screen.getByText('Paid')).toBeInTheDocument(); expect(screen.getByText('Reversed')).toBeInTheDocument(); expect(screen.getByText('Reversal entry')).toBeInTheDocument();
    expect(container.querySelector('[name="status"]')).toBeNull();
    expect(screen.getByRole('link', { name: /Next/ })).toHaveAttribute('href', '/admin/fees?page=2');
    await expectNoAxeViolations(container);
  });
  it('opens details via keyboard, hides reversal from a cashier, links the print page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(PAYMENT)));
    wrap(<PaymentsPanel initial={{ page: 1, pageSize: 25, total: 1, items: [PAYMENT] }} query={{}} owner={false} />);
    const row = screen.getByRole('row', { name: /Sample Student/ }); row.focus(); await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('link', { name: /Reprint/ })).toHaveAttribute('href', `/admin/receipts/${PAYMENT.receiptId}/print`);
    expect(screen.queryByRole('button', { name: 'Reverse payment' })).toBeNull();
  });
  it('owner must give a reason and confirm before reversal', async () => {
    const fetch = vi.fn(async () => json(PAYMENT)); vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    wrap(<PaymentsPanel initial={{ page: 1, pageSize: 25, total: 1, items: [PAYMENT] }} query={{}} owner />);
    await user.click(screen.getByRole('row', { name: /Sample Student/ }));
    expect(await screen.findByRole('button', { name: 'Reverse payment' })).toBeDisabled();
    await user.type(screen.getByLabelText('Reason for reversal'), 'Wrong student');
    await user.click(screen.getByRole('button', { name: 'Reverse payment' }));
    expect(fetch).toHaveBeenCalledTimes(1);
    await user.click(screen.getAllByRole('button', { name: 'Reverse payment' })[1]!);
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(JSON.parse(String((fetch.mock.calls as unknown as [string, RequestInit][])[1]?.[1].body))).toEqual({ reason: 'Wrong student' });
  });
  it('keeps query filtering within the contract and preserves filters across pages', () => {
    const q = paymentsQuery({ method: 'cash', needsRefund: 'true', status: 'paid', page: '2' });
    expect(q).toEqual({ method: 'cash', needsRefund: 'true', page: 2, pageSize: 25 });
    expect(paymentsHref(q)).toContain('needsRefund=true'); expect(paymentsHref(q)).not.toContain('status');
  });
});
