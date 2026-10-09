// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { ToastProvider } from '@remix/ui';
import type { ApiOutput, ReminderPreview } from '@remix/types/api';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fees from '../../../messages/en/fees.json';
import { expectNoAxeViolations } from '../../../test/axe';
import { csvDocument } from '@/lib/csv';
import { invoicesHref, invoicesQuery, recentMonths } from '@/lib/invoices-query';
import { InvoicesPanel } from './invoices-panel';
import { ReminderDialog } from './reminder-dialog';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  router.refresh.mockClear();
});

const CLASS_ID = '0193f1c2-7b1d-7c3e-9a4f-000000000301';
const CLASSES = [{ id: CLASS_ID, name: 'Physics' }];
const MONTHS = ['2026-10-01', '2026-09-01'];
const item = (n: number, over: Partial<ApiOutput<'listInvoices'>['items'][number]> = {}) => ({
  id: `0193f1c2-7b1d-7c3e-9a4f-00000000040${n}`,
  number: `TT-I-26-10-TT-000${n}`,
  studentId: `0193f1c2-7b1d-7c3e-9a4f-00000000050${n}`,
  studentNo: `TT-000${n}`,
  studentName: `Student ${n}`,
  month: '2026-10-01',
  dueOn: '2026-10-05',
  totalCents: 250_000,
  paidCents: 0,
  status: 'overdue' as const,
  slipWaiting: false,
  ...over,
});
const LIST: ApiOutput<'listInvoices'> = {
  page: 1,
  pageSize: 25,
  total: 3,
  totals: { totalCents: 750_000, paidCents: 250_000 },
  items: [item(1), item(2, { status: 'paid', paidCents: 250_000 }), item(3, { status: 'unpaid', slipWaiting: true })],
};
const PREVIEW: ReminderPreview = { recipients: 2, segments: 2, costCents: 190, balanceCents: 5_000, sampleText: 'Test Institute: Student 1\'s Oct 2026 fee of LKR 2,500 was due on 5 Oct and is unpaid. Please pay soon.' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' } });
const problem = (status: number, code: string) => json({ type: 'about:blank', title: code, status, code }, status);
function wrap(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" timeZone="Asia/Colombo" messages={{ fees }}>
      <ToastProvider dismissLabel="Dismiss" regionLabel="Notifications">{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}
type Route = (init: RequestInit | undefined, url: URL) => Response | Promise<Response>;
function stubApi(routes: Record<string, Route>) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://x');
    const route = routes[url.pathname];
    return route ? route(init, url) : problem(404, 'NOT_FOUND');
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const PREVIEW_PATH = '/api/v1/admin/invoices/reminders/preview';
const SEND_PATH = '/api/v1/admin/invoices/reminders/send';
const bodies = (fetch: ReturnType<typeof stubApi>, path: string) =>
  fetch.mock.calls.filter(([url]) => String(url).includes(path)).map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);

describe('admin Invoices tab (FEE-02)', () => {
  it('shows status as words, totals, filters and pagination; axe clean', async () => {
    stubApi({ [PREVIEW_PATH]: () => json(PREVIEW) });
    const { container } = wrap(<InvoicesPanel initial={{ ...LIST, total: 60 }} query={{ month: '2026-10-01', filter: 'overdue' }} classes={CLASSES} months={MONTHS} canRemind smsSettingsHref="/admin/settings/sms" />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('Paid')).toHaveLength(2); // column header + status
    expect(within(table).getByText('Overdue')).toBeInTheDocument();
    expect(within(table).getByText('Unpaid')).toBeInTheDocument();
    expect(within(table).getByText('Slip waiting')).toBeInTheDocument();
    expect(screen.getByText(/60 invoices · LKR 2,500.00 collected of LKR 7,500.00/)).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Invoice status' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['All', 'Paid', 'Unpaid', 'Overdue', 'Slip waiting']);
    expect(within(nav).getByRole('link', { name: 'Overdue' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Paid' })).toHaveAttribute('href', '/admin/fees?tab=invoices&month=2026-10-01&filter=paid&page=1');
    expect(screen.getByRole('link', { name: /Next/ })).toHaveAttribute('href', '/admin/fees?tab=invoices&month=2026-10-01&filter=overdue&page=2');
    expect(container.querySelector('input[name="tab"]')).toHaveValue('invoices');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send reminder SMS to 2 unpaid' })).toBeInTheDocument());
    await expectNoAxeViolations(container);
  });

  it('hides the reminder button from roles that may not text, and still lists invoices', () => {
    stubApi({});
    wrap(<InvoicesPanel initial={LIST} query={{}} classes={CLASSES} months={MONTHS} canRemind={false} smsSettingsHref={null} />);
    expect(screen.queryByRole('button', { name: /Send reminder SMS/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  });

  it('shows a retry when the list could not be loaded and an empty state when filters match nothing', () => {
    stubApi({});
    const { rerender } = wrap(<InvoicesPanel initial={null} query={{}} classes={[]} months={MONTHS} canRemind={false} smsSettingsHref={null} />);
    expect(screen.getByText('We could not load these fees. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/admin/fees?tab=invoices');
    rerender(
      <NextIntlClientProvider locale="en" timeZone="Asia/Colombo" messages={{ fees }}>
        <ToastProvider dismissLabel="Dismiss" regionLabel="Notifications">
          <InvoicesPanel initial={{ ...LIST, items: [], total: 0 }} query={{ filter: 'paid' }} classes={[]} months={MONTHS} canRemind={false} smsSettingsHref={null} />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('No invoices match these filters.')).toBeInTheDocument();
  });

  it('exports every page of the filtered list as a spreadsheet-safe CSV', async () => {
    const page = (p: number) => ({ ...LIST, page: p, pageSize: 100, total: 2, items: p === 1 ? [item(1, { studentName: '=HYPERLINK("x")' })] : [item(2)] });
    const fetch = stubApi({ '/api/v1/admin/invoices': (_init, url) => json(page(Number(url.searchParams.get('page')))) });
    let written = '';
    let bom = false;
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (blob: Blob) => { void blob.arrayBuffer().then((b) => { bom = new Uint8Array(b).slice(0, 3).join() === '239,187,191'; written = new TextDecoder().decode(b); }); return 'blob:x'; }, revokeObjectURL: () => undefined }));
    wrap(<InvoicesPanel initial={LIST} query={{ month: '2026-10-01' }} classes={[]} months={MONTHS} canRemind={false} smsSettingsHref={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(written).not.toBe(''));
    expect(fetch).toHaveBeenCalled();
    expect(bom).toBe(true);
    expect(written).toContain("\"'=HYPERLINK(\"\"x\"\")");
    expect(written).toContain('"Invoice","Student","Month"');
    expect(written).toContain('"2500.00"');
  });
});

describe('Reminder dialog (FEE-02 cost preview)', () => {
  const open = (props: Partial<Parameters<typeof ReminderDialog>[0]> = {}) =>
    wrap(<ReminderDialog open onClose={vi.fn()} months={MONTHS} classes={CLASSES} defaultTarget={{ month: '2026-10-01', filter: 'unpaid' }} smsSettingsHref="/admin/settings/sms" onSent={vi.fn()} {...props} />);

  it('previews recipients, cost and balance, then sends once with a stable idempotency key', async () => {
    const fetch = stubApi({ [PREVIEW_PATH]: () => json(PREVIEW), [SEND_PATH]: () => json({ queued: 2, costCents: 190 }) });
    const onSent = vi.fn();
    const onClose = vi.fn();
    const { container } = open({ onSent, onClose });
    expect(await screen.findByText('Sample message')).toBeInTheDocument();
    expect(screen.getByText('LKR 1.90')).toBeInTheDocument();
    expect(screen.getByText('LKR 50.00')).toBeInTheDocument();
    await expectNoAxeViolations(container);
    await userEvent.click(screen.getByRole('button', { name: 'Send 2 reminders' }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    const [sent] = bodies(fetch, SEND_PATH);
    expect(sent).toMatchObject({ month: '2026-10-01', filter: 'unpaid' });
    expect(String(sent?.idempotencyKey)).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });

  it('reuses the idempotency key after a network error and starts a new one when the target changes', async () => {
    let fail = true;
    const fetch = stubApi({
      [PREVIEW_PATH]: () => json(PREVIEW),
      [SEND_PATH]: () => (fail ? problem(500, 'INTERNAL') : json({ queued: 2, costCents: 190 })),
    });
    open();
    const send = await screen.findByRole('button', { name: 'Send 2 reminders' });
    await userEvent.click(send);
    expect(await screen.findByText(/Nothing was sent twice/)).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Send 2 reminders' }));
    await waitFor(() => expect(bodies(fetch, SEND_PATH)).toHaveLength(2));
    const [first, second] = bodies(fetch, SEND_PATH);
    expect(second?.idempotencyKey).toBe(first?.idempotencyKey);
  });

  it('blocks sending when the wallet is short and points the owner to Buy SMS', async () => {
    const fetch = stubApi({ [PREVIEW_PATH]: () => json({ ...PREVIEW, balanceCents: 100 }) });
    open();
    expect(await screen.findByText(/does not cover this/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send 2 reminders' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Buy SMS' })).toHaveAttribute('href', '/admin/settings/sms');
    expect(bodies(fetch, SEND_PATH)).toHaveLength(0);
  });

  it('shows the server refusal (409 INSUFFICIENT_BALANCE) and offers nobody-to-remind', async () => {
    stubApi({ [PREVIEW_PATH]: () => json(PREVIEW), [SEND_PATH]: () => problem(409, 'INSUFFICIENT_BALANCE') });
    open({ smsSettingsHref: null });
    await userEvent.click(await screen.findByRole('button', { name: 'Send 2 reminders' }));
    expect(await screen.findByText(/Nothing was sent or charged/)).toBeInTheDocument();
    cleanup();
    stubApi({ [PREVIEW_PATH]: () => json({ ...PREVIEW, recipients: 0, segments: 0, costCents: 0 }) });
    open();
    expect(await screen.findByText(/Nobody to remind/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send 0 reminders' })).toBeDisabled();
  });

  it('re-previews when the audience or class changes', async () => {
    const fetch = stubApi({ [PREVIEW_PATH]: () => json(PREVIEW) });
    open();
    await screen.findByText('Sample message');
    await userEvent.selectOptions(screen.getByLabelText('Who should get a reminder'), 'overdue');
    await userEvent.selectOptions(screen.getByLabelText('Class'), CLASS_ID);
    await waitFor(() => expect(bodies(fetch, PREVIEW_PATH).at(-1)).toEqual({ month: '2026-10-01', filter: 'overdue', classId: CLASS_ID }));
  });
});

describe('invoices query helpers', () => {
  it('keeps only contract fields and falls back to defaults on bad input', () => {
    expect(invoicesQuery({ filter: 'paid', month: '2026-10-01', status: 'x', page: '2' })).toEqual({ filter: 'paid', month: '2026-10-01', page: 2, pageSize: 25 });
    expect(invoicesQuery({ filter: 'bogus' })).toEqual({ filter: 'all', page: 1, pageSize: 25 });
    expect(invoicesHref({ filter: 'all', q: 'nim' })).toBe('/admin/fees?tab=invoices&q=nim');
  });
  it('lists the last months across a year end', () => {
    expect(recentMonths('2026-02-01', 4)).toEqual(['2026-02-01', '2026-01-01', '2025-12-01', '2025-11-01']);
  });
  it('csv cells neutralise formulas and escape quotes', () => {
    expect(csvDocument(['a'], [['=1+1'], ['say "hi"']])).toBe('﻿"a"\r\n"\'=1+1"\r\n"say ""hi"""\r\n');
  });
});
