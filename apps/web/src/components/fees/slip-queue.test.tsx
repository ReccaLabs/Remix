// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Slip } from '@remix/types/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { SlipQueue } from './slip-queue';
import { FEES, json, wrap } from './test-fixtures';

const slip = (n: number, extra: Partial<Slip> = {}): Slip => ({
  id: `0193f1c2-7b1d-7c3e-9a4f-00000000070${n}`,
  status: 'submitted',
  studentId: FEES.studentId,
  studentNo: `TT-0000${n}`,
  studentName: `Sample Student ${n}`,
  submittedAt: `2026-10-15T0${n}:00:00Z`,
  amountCents: 500000,
  expectedCents: 500000,
  reference: `BOC ${n}`,
  slipDate: '2026-10-14',
  lines: FEES.openLines,
  duplicateOf: null,
  rejectReason: null,
  reviewedByName: null,
  reviewedAt: null,
  ...extra,
});

type Call = [string, RequestInit | undefined];
function api(handler: (url: string, init?: RequestInit) => Response | undefined = () => undefined) {
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const custom = handler(url, init);
    if (custom) return custom;
    if (url.endsWith('/image')) return json({ url: `https://storage.example.test/${url.split('/')[5]}.jpg?sig=x`, expiresAt: '2026-10-15T05:00:00Z' });
    if (url.endsWith('/approve')) return json({ ...slip(1), status: 'approved' });
    if (url.endsWith('/reject')) return json({ ...slip(1), status: 'rejected', rejectReason: 'x' });
    if (url.includes('/api/v1/admin/slips?')) return json({ page: 1, pageSize: 100, total: 0, items: [] });
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetch);
  const calls = () => fetch.mock.calls as unknown as Call[];
  return { fetch, calls, posts: () => calls().filter(([, init]) => init?.method === 'POST').map(([url, init]) => [url, init?.body] as const) };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('bank slip queue 11a/11b (FEE-06)', () => {
  it('shows the oldest slip with its photo, expected vs written amount and no duplicate; axe clean', async () => {
    api();
    const { container } = wrap(<SlipQueue initial={[slip(1, { amountCents: 450000 }), slip(2)]} />);
    expect(screen.getByRole('heading', { name: /Sample Student 1/ })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Bank slip photo from Sample Student 1' })).toHaveAttribute('src', expect.stringContaining('storage.example.test'));
    expect(screen.getByText('Slip 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('LKR 5,000.00', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('LKR 4,500.00', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText(/Approve pays the expected amount/)).toBeInTheDocument();
    expect(screen.getByText('Reference not used before')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('works keyboard-only: A approves and advances, S skips, R opens the reason dialog and rejects', async () => {
    const http = api();
    wrap(<SlipQueue initial={[slip(1), slip(2), slip(3)]} />);
    await screen.findByRole('img', { name: /Sample Student 1/ });
    await userEvent.keyboard('a');
    expect(await screen.findByText('Approved. Receipt created.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Sample Student 2/ })).toBeInTheDocument();
    expect(http.posts()[0]?.[0]).toBe(`/api/v1/admin/slips/${slip(1).id}/approve`);
    expect(JSON.parse(String(http.posts()[0]?.[1]))).toEqual({ confirmDuplicate: false });

    await userEvent.keyboard('s');
    expect(screen.getByRole('heading', { name: /Sample Student 3/ })).toBeInTheDocument();
    await userEvent.keyboard('r');
    const dialog = await screen.findByRole('dialog', { name: 'Reject slip from Sample Student 3?' });
    // Typing in the dialog never triggers the queue shortcuts.
    await userEvent.click(screen.getByLabelText('Photo is not clear'));
    await userEvent.type(screen.getByLabelText('Note (optional)'), 'as');
    await userEvent.click(screen.getByRole('button', { name: 'Reject slip' }));
    expect(await screen.findByText('Rejected. The student can send a new slip.')).toBeInTheDocument();
    expect(dialog).not.toBeVisible();
    const reject = http.posts().find(([url]) => url.endsWith('/reject'));
    expect(reject?.[0]).toBe(`/api/v1/admin/slips/${slip(3).id}/reject`);
    expect(JSON.parse(String(reject?.[1]))).toEqual({ reason: 'Photo is not clear: as' });
    expect(http.posts()).toHaveLength(2);
    expect(screen.getByRole('heading', { name: /Sample Student 2/ })).toBeInTheDocument();
  });

  it('requires ticking the duplicate confirmation before approving a reused reference', async () => {
    const http = api();
    wrap(<SlipQueue initial={[slip(1, { duplicateOf: { slipId: slip(9).id, studentName: 'Other Student', approvedAt: '2026-10-01T04:00:00Z' } })]} />);
    expect(screen.getByText(/Reference used before: approved for Other Student/)).toBeInTheDocument();
    await userEvent.keyboard('a');
    expect(await screen.findByRole('alert')).toHaveTextContent('Tick the confirmation');
    expect(http.posts()).toHaveLength(0);
    await userEvent.click(screen.getByRole('checkbox', { name: /approve although the reference was used before/ }));
    await userEvent.click(screen.getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(http.posts()).toHaveLength(1));
    expect(JSON.parse(String(http.posts()[0]?.[1]))).toEqual({ confirmDuplicate: true });
  });

  it('moves past a slip that changed meanwhile and shows the empty queue', async () => {
    api((url) => url.endsWith('/approve') ? json({ type: 'about:blank', title: 'No longer waiting', code: 'CONFLICT', status: 409 }, 409) : undefined);
    wrap(<SlipQueue initial={[slip(1)]} />);
    await userEvent.keyboard('a');
    expect(await screen.findByText(/This slip changed meanwhile/)).toBeInTheDocument();
    expect(await screen.findByText('No slips waiting')).toBeInTheDocument();
  });

  it('rotates and zooms the photo for reading', async () => {
    api();
    wrap(<SlipQueue initial={[slip(1)]} />);
    const img = await screen.findByRole('img', { name: /Sample Student 1/ });
    await userEvent.click(screen.getByRole('button', { name: 'Rotate photo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(img.getAttribute('style')).toContain('rotate(90deg) scale(1.25)');
  });
});
