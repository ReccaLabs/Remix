// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudentCard } from '@remix/types/api';
import students from '../../../messages/en/students.json';
import { expectNoAxeViolations } from '../../../test/axe';
import { CardPanel } from './card-panel';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const STUDENT = '0193f1c2-7b1d-7c3e-9a4f-000000000101';
const CARD: StudentCard = {
  id: '0193f1c2-7b1d-7c3e-9a4f-000000000901',
  studentId: STUDENT,
  code: 'NIL-26-0042-1',
  kind: 'temporary',
  formats: ['barcode'],
  nfcUidHint: null,
  status: 'active',
  issuedAt: '2026-10-05T10:00:00Z',
  activatedAt: '2026-10-05T10:00:00Z',
  revokedAt: null,
  revokeReason: null,
};
const ORDER: StudentCard = {
  ...CARD,
  id: '0193f1c2-7b1d-7c3e-9a4f-000000000902',
  code: 'NIL-26-0042-2',
  kind: 'permanent',
  formats: ['barcode', 'qr', 'nfc'],
  status: 'ordered',
  activatedAt: null,
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': status < 400 ? 'application/json' : 'application/problem+json' },
  });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function setup(
  initial: StudentCard[] | null = [CARD, ORDER],
  options: { canWrite?: boolean; archived?: boolean } = {},
) {
  let cards = initial ?? [CARD];
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const print = { location: { href: '' }, opener: null, close: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(print as unknown as Window);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'GET') return json({ items: cards });
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url, body });
      if (url.endsWith('/activate')) {
        cards = cards.map((c) =>
          c.id === ORDER.id
            ? {
                ...c,
                status: 'active',
                activatedAt: CARD.activatedAt,
                nfcUidHint: '\u2022\u2022\u2022\u20221B9C',
              }
            : { ...c, status: 'revoked', revokedAt: CARD.issuedAt, revokeReason: 'replaced' },
        );
        return json(cards.find((c) => c.id === ORDER.id));
      }
      if (url.endsWith('/revoke')) {
        cards = cards.map((c) =>
          c.id === CARD.id
            ? {
                ...c,
                status: 'revoked',
                revokedAt: CARD.issuedAt,
                revokeReason: String(body.reason),
              }
            : c,
        );
        return json(cards.find((c) => c.id === CARD.id));
      }
      const card = body.kind === 'temporary' ? CARD : ORDER;
      cards = [card];
      return json(card, 201);
    }),
  );
  const result = render(
    <NextIntlClientProvider locale="en" timeZone="Asia/Colombo" messages={{ students }}>
      <CardPanel
        studentId={STUDENT}
        canWrite={options.canWrite ?? true}
        archived={options.archived ?? false}
        initial={initial}
      />
    </NextIntlClientProvider>,
  );
  return { ...result, calls, print, user: userEvent.setup() };
}
describe('STU-06 profile Card section', () => {
  it('shows active/ordered code, formats, dates and words plus status colours; axe clean', async () => {
    const { container } = setup();
    expect(screen.getByText('Ordered - ReMix is printing it')).toBeInTheDocument();
    expect(screen.getByText('NIL-26-0042-1')).toBeInTheDocument();
    expect(screen.getByText('Active')).toHaveClass('text-success-ink');
    expect(screen.getByText('Ordered')).toHaveClass('text-warning-ink');
    expect(screen.queryByRole('button', { name: /Tap card/ })).toBeNull();
    await expectNoAxeViolations(container);
  });
  it('issues barcode-only temporary and opens the print page after the request', async () => {
    const { user, calls, print } = setup([]);
    await user.click(screen.getByRole('button', { name: /Print temporary/ }));
    await waitFor(() => expect(print.location.href).toBe(`/admin/students/${STUDENT}/card/print`));
    expect(calls[0]?.body).toEqual({ kind: 'temporary' });
  });
  it('orders barcode plus optional QR/NFC using the confirmation dialog', async () => {
    const { user, calls, container } = setup([]);
    await user.click(screen.getByRole('button', { name: /Order permanent/ }));
    expect(screen.getByLabelText('Barcode')).toBeChecked();
    expect(screen.getByLabelText('Barcode')).toBeDisabled();
    await user.click(screen.getByLabelText('QR'));
    await user.click(screen.getByLabelText('NFC'));
    await expectNoAxeViolations(container);
    const buttons = screen.getAllByRole('button', { name: /Order permanent/ });
    await user.click(buttons.at(-1)!);
    await waitFor(() =>
      expect(calls[0]?.body).toEqual({ kind: 'permanent', formats: ['barcode', 'qr', 'nfc'] }),
    );
  });
  it('hands over with an optional UID and shows the retired temporary card in history', async () => {
    const { user, calls } = setup();
    await user.click(screen.getByRole('button', { name: /Hand over/ }));
    expect(screen.queryByRole('button', { name: /Tap card/ })).toBeNull();
    await user.type(screen.getByLabelText('Chip UID (optional)'), '04:a2:1b:9c');
    await user.click(screen.getAllByRole('button', { name: /Hand over/ }).at(-1)!);
    await waitFor(() => expect(calls[0]?.body).toEqual({ nfcUid: '04A21B9C' }));
    await user.click(screen.getByText('Card history'));
    expect(await screen.findByText(/replaced/)).toBeInTheDocument();
  });
  it('requires a reason and confirmation before revocation', async () => {
    const { user, calls } = setup([CARD]);
    await user.click(screen.getByRole('button', { name: /Revoke/ }));
    await user.click(screen.getAllByRole('button', { name: /Revoke/ }).at(-1)!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a reason');
    expect(calls).toHaveLength(0);
    await user.type(screen.getByLabelText('Reason for revoking'), 'Lost card');
    await user.click(screen.getAllByRole('button', { name: /Revoke/ }).at(-1)!);
    await waitFor(() => expect(calls[0]?.body).toEqual({ reason: 'Lost card' }));
  });
  it('supports read-only cashier and disables issue for archived students', () => {
    setup([CARD], { canWrite: false });
    expect(
      screen.queryByRole('button', { name: /Revoke|Order permanent|Print temporary/ }),
    ).toBeNull();
    cleanup();
    setup([], { archived: true });
    expect(screen.getByRole('button', { name: /Order permanent/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Print temporary/ })).toBeDisabled();
  });
  it('offers retry when cards could not be loaded', async () => {
    const { user } = setup(null);
    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(CARD.code)).toBeInTheDocument();
  });
});
