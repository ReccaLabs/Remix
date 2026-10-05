// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { ProfilePayments } from './profile-payments';
import { FEES, PAYMENT, json, wrap } from './test-fixtures';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('student profile Payments and manual dialog (FEE-08/FEE-10)', () => {
  it('shows open months/history, respects collect permission and is axe clean', async () => {
    const { container } = wrap(<ProfilePayments initial={{ ...FEES, payments: [PAYMENT] }} studentId={FEES.studentId} canCollect={false} />);
    expect(screen.getByText('Open months')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Payment history' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull();
    expect(screen.getAllByRole('link', { name: /Reprint/ })[0]).toHaveAttribute('href', `/admin/receipts/${PAYMENT.receiptId}/print`);
    await expectNoAxeViolations(container);
  });
  it('collects chosen months with kind/reference/date/note and refreshes the profile', async () => {
    const posted: object[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).endsWith('/manual')) { posted.push(JSON.parse(String(init?.body)) as object); return json(PAYMENT); }
      return json({ ...FEES, openLines: [], payments: [PAYMENT] });
    }));
    const user = userEvent.setup();
    const { container } = wrap(<ProfilePayments initial={FEES} studentId={FEES.studentId} canCollect />);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    await user.click(screen.getByLabelText(/Physics.*September/));
    await user.selectOptions(screen.getByLabelText('Payment kind'), 'cheque');
    await user.type(screen.getByLabelText('Reference'), 'CHEQUE-42');
    await user.clear(screen.getByLabelText('Received on')); await user.type(screen.getByLabelText('Received on'), '2026-10-01');
    await user.type(screen.getByLabelText('Note'), 'Statement checked');
    await expectNoAxeViolations(container);
    await user.click(screen.getAllByRole('button', { name: 'Record payment' })[1]!);
    await waitFor(() => expect(screen.queryByText('Record manual payment')).toBeNull());
    expect(posted[0]).toMatchObject({ studentId: FEES.studentId, lineIds: [FEES.openLines[0]?.id], kind: 'cheque', reference: 'CHEQUE-42', receivedOn: '2026-10-01', note: 'Statement checked' });
    expect(screen.getByText('All months are paid')).toBeInTheDocument();
  });
  it('rejects future dates before sending and preserves retry identity after network failure', async () => {
    const requests: object[] = []; let attempt = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => { requests.push(JSON.parse(String(init?.body)) as object); attempt++; if (attempt === 1) throw new TypeError('offline'); return json({ type: 'about:blank', title: 'Conflict', code: 'CONFLICT', status: 409 }, 409); }));
    const user = userEvent.setup(); wrap(<ProfilePayments initial={FEES} studentId={FEES.studentId} canCollect />);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    await user.click(screen.getByLabelText(/Physics.*September/));
    await user.type(screen.getByLabelText('Reference'), 'BANK-123');
    await user.clear(screen.getByLabelText('Received on')); await user.type(screen.getByLabelText('Received on'), '2099-01-01');
    await user.click(screen.getAllByRole('button', { name: 'Record payment' })[1]!); expect(requests).toHaveLength(0);
    await user.clear(screen.getByLabelText('Received on')); await user.type(screen.getByLabelText('Received on'), '2026-10-01');
    await user.click(screen.getAllByRole('button', { name: 'Record payment' })[1]!);
    await screen.findByText(/Retry with the same payment details/);
    await user.click(screen.getAllByRole('button', { name: 'Record payment' })[1]!);
    expect(await screen.findByRole('alert')).toHaveTextContent('conflicts with an earlier payment');
    expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]);
  });
});
