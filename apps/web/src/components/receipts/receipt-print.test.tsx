// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Receipt } from '@remix/types/api';
import settings from '../../../messages/en/settings.json';
import { expectNoAxeViolations } from '../../../test/axe';
import { ReceiptPrint } from './receipt-print';
import { ReprintButton } from './reprint-button';
const receipt: Receipt = {
  id: '0193f1c2-7b1d-7c3e-9a4f-000000000900',
  number: 'SAMPLE-R-26-00001',
  paymentId: '0193f1c2-7b1d-7c3e-9a4f-000000000901',
  issuedAt: '2026-10-15T04:30:00Z',
  method: 'cash',
  amountCents: 250000,
  cashReceivedCents: 300000,
  changeCents: 50000,
  studentNo: 'SAMPLE-00001',
  studentName: 'Sample Student',
  lines: [{ className: 'Sample Physics', month: '2026-10-01', amountCents: 250000 }],
  reversedAt: null,
  institute: {
    name: 'Sample Institute',
    logoUrl: null,
    address: 'Sample Road',
    phone: '0111234567',
    footer: 'Thank you',
  },
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const view = (value = receipt) =>
  render(
    <NextIntlClientProvider locale="en" timeZone="Asia/Colombo" messages={{ settings }}>
      <ReceiptPrint receipt={value} />
      <ReprintButton />
    </NextIntlClientProvider>,
  );
describe('FEE-09 thermal receipt', () => {
  it('is axe-clean, renders institute/lines/change and reprints', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { container } = view();
    await expectNoAxeViolations(container);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(receipt.number);
    expect(screen.getByText('Sample Institute')).toBeInTheDocument();
    expect(screen.getByText('LKR 500.00')).toBeInTheDocument();
    expect(screen.getByText('Thank you')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reprint receipt' }));
    expect(print).toHaveBeenCalledOnce();
  });
  it('shows reversal in words, omits noncash tender/change and escapes all user text', async () => {
    const { container } = view({
      ...receipt,
      method: 'manual',
      cashReceivedCents: null,
      changeCents: null,
      reversedAt: receipt.issuedAt,
      studentName: '<script>sample</script>',
    });
    expect(screen.getByText(/REVERSED/)).toBeInTheDocument();
    expect(screen.queryByText('Change')).not.toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>sample</script>');
    await expectNoAxeViolations(container);
  });
});
