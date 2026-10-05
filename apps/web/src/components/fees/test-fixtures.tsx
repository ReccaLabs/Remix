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

export const STUDENT = { id: PAYMENT.studentId, studentNo: 'TT-00001', displayName: PAYMENT.studentName, phone: '+94771234567', school: null, alYear: null, status: 'active', classNames: ['Physics'], activeDevices: 0, joinedAt: '2026-10-01T00:00:00Z' };
export const FEES = { studentId: STUDENT.id, studentNo: STUDENT.studentNo, displayName: STUDENT.displayName, payments: [], openLines: PAYMENT.lines.map(l => ({ id: l.lineId, invoiceId: PAYMENT.id, invoiceNumber: 'TT-I-26', enrollmentId: PAYMENT.id, classId: PAYMENT.id, className: l.className, month: l.month, dueOn: `${l.month.slice(0, 7)}-05`, amountCents: 250000, paidCents: 0, openCents: 250000, paid: false, overdue: true, slipWaiting: false })) };
