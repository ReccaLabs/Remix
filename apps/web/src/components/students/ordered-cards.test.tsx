// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import students from '../../../messages/en/students.json';
import { expectNoAxeViolations } from '../../../test/axe';
import { CardFront } from './card-front';
import { CardQr } from './card-qr';
import { OrderedCards } from './ordered-cards';

const card = {
  id: 'card',
  studentId: 'student',
  code: 'NIL-26-0042-1',
  studentNo: 'NIL-26-0042',
  displayName: 'Sample Student',
  formats: ['barcode', 'qr', 'nfc'] as ('barcode' | 'qr' | 'nfc')[],
  issuedAt: '2026-10-05T10:00:00Z',
};
afterEach(cleanup);
describe('STU-06 ordered cards', () => {
  it('links orders to profiles and print sheets, with formats and status; axe clean', async () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" timeZone="Asia/Colombo" messages={{ students }}>
        <main>
          <h1>Cards</h1>
          <OrderedCards cards={[card]} />
        </main>
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('link', { name: 'Sample Student' })).toHaveAttribute(
      'href',
      '/admin/students/student',
    );
    expect(screen.getByRole('link', { name: /Print sheet/ })).toHaveAttribute(
      'href',
      '/admin/students/cards/print',
    );
    expect(screen.getByText('Ordered')).toHaveClass('text-warning-ink');
    expect(screen.getByText('Formats: Barcode / QR / NFC')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
  it('renders a permanent card front with barcode, QR and NFC mark; axe clean', async () => {
    const { container } = render(
      <main>
        <h1>Print sheet</h1>
        <CardFront
          institute="Nilanka Institute"
          name={card.displayName}
          studentNo={card.studentNo}
          code={card.code}
          kindLabel="Permanent card"
          barcodeLabel="Card barcode"
          nfcLabel="NFC"
          qr={<CardQr code={card.code} label="Card QR" />}
        />
      </main>,
    );
    expect(screen.getByRole('img', { name: 'Card QR' })).toHaveAttribute(
      'shape-rendering',
      'crispEdges',
    );
    expect(screen.getByText('Permanent card / NFC')).toBeInTheDocument();
    const qr = screen.getByRole('img', { name: 'Card QR' });
    expect(qr.querySelectorAll('g rect').length).toBeGreaterThan(100);
    expect(qr.querySelector('g rect')).toHaveAttribute('x', '4');
    await expectNoAxeViolations(container);
  });
});
