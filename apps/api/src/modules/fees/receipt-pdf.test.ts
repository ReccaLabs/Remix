import { describe, expect, it } from 'vitest';
import type { Receipt } from '@remix/types/api';
import { renderReceiptPdf } from './receipt-pdf';
const receipt: Receipt = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  number: 'SA-R-26-00001',
  paymentId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
  issuedAt: '2026-10-15T04:30:00Z',
  method: 'cash',
  amountCents: 250000,
  cashReceivedCents: 300000,
  changeCents: 50000,
  studentNo: 'SA-00001',
  studentName: 'Sample (Student) \\ safe',
  lines: [{ className: 'Physics', month: '2026-10-01', amountCents: 250000 }],
  reversedAt: null,
  institute: {
    name: 'Sample Institute',
    address: 'Sample Road',
    phone: '0111234567',
    footer: 'Thank you',
    logoUrl: null,
  },
};
describe('FEE-09 minimal PDF writer', () => {
  it('writes a valid cross-reference table with exact byte offsets and stream lengths', () => {
    const pdf = renderReceiptPdf(receipt).toString('ascii');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.endsWith('%%EOF\n')).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(xref).startsWith('xref')).toBe(true);
    const entries = [...pdf.matchAll(/^(\d{10}) 00000 n /gm)];
    for (const [i, entry] of entries.entries())
      expect(pdf.slice(Number(entry[1])).startsWith(`${i + 1} 0 obj`)).toBe(true);
    for (const stream of pdf.matchAll(/\/Length (\d+) >>\nstream\n([\s\S]*?)endstream/g))
      expect(Buffer.byteLength(stream[2]!, 'ascii')).toBe(Number(stream[1]));
    expect(pdf).toContain('LKR 2,500.00');
    expect(pdf).toContain('Cash received: LKR 3,000.00');
    expect(pdf).toContain('Change: LKR 500.00');
  });
  it('escapes all PDF literal delimiters, renders reversal and never interprets user text as syntax', () => {
    const pdf = renderReceiptPdf({ ...receipt, reversedAt: receipt.issuedAt }).toString('ascii');
    expect(pdf).toContain('Sample \\(Student\\) \\\\ safe');
    expect(pdf).toContain('(REVERSED)');
  });
  it('wraps long words, paginates long receipts and replaces unsupported glyphs explicitly', () => {
    const pdf = renderReceiptPdf({
      ...receipt,
      studentName: 'සිංහල தமிழ்',
      lines: Array.from({ length: 150 }, () => ({
        className: 'x'.repeat(200),
        month: '2026-10-01',
        amountCents: 100,
      })),
    }).toString('ascii');
    expect(pdf).not.toContain('සිංහල');
    expect(pdf).toContain('?');
    expect(Number(/\/Count (\d+)/.exec(pdf)![1])).toBeGreaterThan(1);
    for (const line of pdf.matchAll(/^\((.*)\) Tj/gm))
      expect(line[1]!.length).toBeLessThanOrEqual(84);
  });
});
