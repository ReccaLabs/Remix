// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { CashCounter } from './cash-counter';
import { PAYMENT, FEES, STUDENT, json, wrap } from './test-fixtures';
import { cashCents } from '@/lib/fees-money';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function setup(response?: (body: unknown) => Response) {
  const requests: object[] = [];
  const print = { location: { href: '' }, opener: null, close: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(print as unknown as Window);
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/students?')) return json({ page: 1, pageSize: 25, total: 1, items: [STUDENT] });
    if (url.endsWith('/fees')) return json(FEES);
    const body = JSON.parse(String(init?.body)) as object; requests.push(body);
    return response ? response(body) : json(PAYMENT);
  }));
  return { requests, print };
}
async function choose() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Search student'), 'Sample{Enter}');
  const result = await screen.findByRole('button', { name: /Choose Sample Student/ });
  result.focus(); await user.keyboard('{Enter}');
  await screen.findByLabelText(/Physics.*September/);
  return user;
}
describe('keyboard cash counter (FEE-07)', () => {
  it('takes two months using only keys, opens print, resets, and is axe clean', async () => {
    const { requests, print } = setup(); const { container } = wrap(<CashCounter />);
    expect(screen.getByLabelText('Search student')).toHaveFocus();
    const user = await choose();
    await waitFor(() => expect(screen.getByLabelText(/Physics.*September/)).toHaveFocus());
    await user.keyboard(' '); await user.tab(); await user.keyboard(' '); await user.tab();
    expect(screen.getByLabelText('Cash received (LKR)')).toHaveFocus();
    await user.keyboard('6000'); expect(screen.getByText('LKR 1,000.00')).toBeInTheDocument();
    await expectNoAxeViolations(container);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(requests).toHaveLength(1));
    await waitFor(() => expect(screen.getByLabelText('Search student')).toHaveFocus());
    expect(requests[0]).toMatchObject({ studentId: STUDENT.id, lineIds: PAYMENT.lines.map(l => l.lineId), cashReceivedCents: 600000 });
    expect(print.location.href).toBe(`/admin/receipts/${PAYMENT.receiptId}/print`);
    expect(screen.queryByLabelText('Cash received (LKR)')).toBeNull();
    expect(screen.getByLabelText('Search student')).toHaveValue('');
  });
  it('insufficient cash sends no request; Esc clears selection and restores search focus', async () => {
    const { requests } = setup(); wrap(<CashCounter />); const user = await choose();
    await user.click(screen.getByLabelText(/Physics.*September/));
    await user.type(screen.getByLabelText('Cash received (LKR)'), '1{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Cash received must cover'); expect(requests).toHaveLength(0);
    await user.keyboard('{Escape}'); expect(screen.getByLabelText('Search student')).toHaveFocus();
    expect(screen.queryByText('Open months')).toBeNull();
  });
  it('retries an uncertain result with the identical key and reports already-paid conflicts', async () => {
    let attempt = 0;
    const { requests } = setup(() => { attempt++; if (attempt === 1) throw new TypeError('offline'); return json({ type: 'about:blank', title: 'Already paid', status: 409, code: 'ALREADY_PAID' }, 409); });
    wrap(<CashCounter />); const user = await choose();
    await user.click(screen.getByLabelText(/Physics.*September/));
    await user.type(screen.getByLabelText('Cash received (LKR)'), '3000{Enter}');
    await screen.findByText(/Retry with the same payment details/);
    await user.click(screen.getByRole('button', { name: /Collect & print/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already been paid');
    expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]);
  });
  it('parses cents exactly and refuses sub-cent, negative, exponent and unsafe amounts', () => {
    expect(cashCents('2500.01')).toBe(250001); expect(cashCents('1.2')).toBe(120);
    for (const invalid of ['', '-1', '1.001', '1e4', '9007199254740992']) expect(cashCents(invalid)).toBeNull();
  });
});
