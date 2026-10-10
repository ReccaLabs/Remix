// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { feeBusinessDate } from '@/lib/fees-money';
import { slipContentType, SlipUpload } from './slip-upload';
import { FEES, json, wrap } from './test-fixtures';

const UPLOAD = '0193f1c2-7b1d-7c3e-9a4f-000000000601';
const SLIP = '0193f1c2-7b1d-7c3e-9a4f-000000000602';
const photo = (size = 1200, name = 'IMG_4821.jpg', type = 'image/jpeg') => new File([new Uint8Array(size)], name, { type });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('student bank slip upload 6c/6e (FEE-05)', () => {
  it('uploads the photo with the presigned PUT, then submits ids only and shows "Checking"; axe clean', async () => {
    const fetch = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/v1/me/slips/upload') return json({ uploadId: UPLOAD, url: 'https://storage.example.test/t/slips/a.jpg?sig=x', headers: { 'content-type': 'image/jpeg' }, expiresAt: '2026-10-15T05:00:00Z' });
      if (url.startsWith('https://storage.example.test/')) return new Response(null, { status: 200 });
      if (url === '/api/v1/me/slips') return json({ id: SLIP, status: 'processing', studentId: FEES.studentId, studentNo: FEES.studentNo, studentName: FEES.displayName,
        submittedAt: '2026-10-15T04:31:00Z', amountCents: 500000, expectedCents: 500000, reference: (JSON.parse(String(init?.body)) as { reference: string }).reference,
        slipDate: '2026-10-15', lines: FEES.openLines, duplicateOf: null, rejectReason: null, reviewedByName: null, reviewedAt: null });
      return json({}, 404);
    });
    vi.stubGlobal('fetch', fetch);
    const { container } = wrap(<SlipUpload lines={FEES.openLines} slips={[]} />);
    await expectNoAxeViolations(container);
    expect(screen.getByLabelText('Amount on the slip (LKR)')).toHaveValue('5000.00');
    await userEvent.upload(screen.getByLabelText('Slip photo'), photo());
    await userEvent.type(screen.getByLabelText('Reference number (on the slip)'), 'BOC 26092026 0457');
    await userEvent.click(screen.getByRole('button', { name: 'Send slip' }));
    expect(await screen.findByText('Slip sent')).toBeInTheDocument();
    expect(screen.getByText('Checking')).toBeInTheDocument();
    const calls = fetch.mock.calls as unknown as [string, RequestInit | undefined][];
    expect(calls.map(([u]) => u)).toEqual(['/api/v1/me/slips/upload', 'https://storage.example.test/t/slips/a.jpg?sig=x', '/api/v1/me/slips']);
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({ contentType: 'image/jpeg', sizeBytes: 1200 });
    expect(calls[1]?.[1]).toMatchObject({ method: 'PUT', headers: { 'content-type': 'image/jpeg' }, credentials: 'omit' });
    expect(JSON.parse(String(calls[2]?.[1]?.body))).toEqual({
      uploadId: UPLOAD, lineIds: FEES.openLines.map((l) => l.id), amountCents: 500000, reference: 'BOC 26092026 0457', slipDate: feeBusinessDate(),
    });
  });

  it('refuses oversized and non-image files before any request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    wrap(<SlipUpload lines={FEES.openLines} slips={[]} />);
    await userEvent.upload(screen.getByLabelText('Slip photo'), photo(5 * 1024 * 1024 + 1));
    expect(screen.getByText(/larger than 5 MB/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send slip' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the months, photo');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says so when the storage upload fails, and lists earlier slips with status words and reasons', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => String(input) === '/api/v1/me/slips/upload'
      ? json({ uploadId: UPLOAD, url: 'https://storage.example.test/x?sig=x', headers: { 'content-type': 'image/png' }, expiresAt: '2026-10-15T05:00:00Z' })
      : new Response(null, { status: 403 })));
    wrap(<SlipUpload lines={FEES.openLines} slips={[{ id: SLIP, status: 'rejected', submittedAt: '2026-10-14T04:00:00Z', amountCents: 250000, reference: 'OLD 1', rejectReason: 'Photo is not clear' }]} />);
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('Reason: Photo is not clear')).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText('Slip photo'), photo(300, 'slip.png', 'image/png'));
    await userEvent.type(screen.getByLabelText('Reference number (on the slip)'), 'REF 1');
    await userEvent.click(screen.getByRole('button', { name: 'Send slip' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be uploaded');
  });

  it('hides the form when every open month already has a slip waiting', () => {
    wrap(<SlipUpload lines={FEES.openLines.map((l) => ({ ...l, slipWaiting: true }))} slips={[{ id: SLIP, status: 'submitted', submittedAt: '2026-10-14T04:00:00Z', amountCents: 500000, reference: 'R 1', rejectReason: null }]} />);
    expect(screen.queryByRole('button', { name: 'Send slip' })).toBeNull();
    expect(screen.getByText('Checking')).toBeInTheDocument();
  });

  it('infers HEIC from the extension when the browser reports no type', () => {
    expect(slipContentType(photo(10, 'IMG_1.HEIC', ''))).toBe('image/heic');
    expect(slipContentType(photo(10, 'scan.pdf', 'application/pdf'))).toBeNull();
  });
});
