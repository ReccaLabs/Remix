import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { Payment } from '@remix/types/api';
import type { ReactNode } from 'react';
import fees from '../../../messages/en/fees.json';
export const ID = '0193f1c2-7b1d-7c3e-9a4f-000000000901';
export const PAYMENT: Payment = { id: ID, method: 'cash', amountCents: 500000, unallocatedCents: 0, needsRefund: false,
  studentId: '0193f1c2-7b1d-7c3e-9a4f-000000000101', studentName: 'Sample Student', receivedAt: '2026-10-15T04:30:00Z', receivedByName: 'Sample Cashier', reference: null, note: null,
  reversedByPaymentId: null, reversesPaymentId: null, receiptId: '0193f1c2-7b1d-7c3e-9a4f-000000000900', receiptNumber: 'TT-R-26-00001',
  lines: [{ lineId: '0193f1c2-7b1d-7c3e-9a4f-000000000801', className: 'Physics', month: '2026-09-01', amountCents: 250000 }, { lineId: '0193f1c2-7b1d-7c3e-9a4f-000000000802', className: 'Physics', month: '2026-10-01', amountCents: 250000 }] };
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' } });
export function wrap(ui: ReactNode) { return render(<NextIntlClientProvider locale="en" timeZone="Asia/Colombo" messages={{ fees }}>{ui}</NextIntlClientProvider>); }
