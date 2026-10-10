import { describe, expect, it } from 'vitest';
import { SMS_SEGMENT_PRICE_CENTS, smsSegments } from '@remix/types/api';
import { addDays, calendarDate } from '../../common/time/business-date';
import { dayLabel, monthLabel, renderSmsTemplate, SMS_TEMPLATES } from './sms-templates';

const I = 'Kamal Physics';
describe('system SMS templates (MSG-04)', () => {
  it('renders every template as a single English segment for ordinary names', () => {
    const texts = {
      receipt_issued: renderSmsTemplate('receipt_issued', { institute: I, student: 'Nimali Perera', amountCents: 250_000, receiptNo: 'KPH-R-26-00012' }),
      slip_approved: renderSmsTemplate('slip_approved', { institute: I, months: 'Oct 2026', receiptNo: 'KPH-R-26-00012' }),
      slip_rejected: renderSmsTemplate('slip_rejected', { institute: I, reason: 'Amount does not match' }),
      fee_reminder_before: renderSmsTemplate('fee_reminder_before', { institute: I, student: 'Nimali Perera', month: '2026-10', amountCents: 250_000, dueOn: '2026-10-05' }),
      fee_reminder_overdue: renderSmsTemplate('fee_reminder_overdue', { institute: I, student: 'Nimali Perera', month: '2026-10', amountCents: 250_000, dueOn: '2026-10-05' }),
    } satisfies Record<(typeof SMS_TEMPLATES)[number], { text: string; segments: number }>;
    for (const [name, r] of Object.entries(texts)) {
      expect(r.segments, name).toBe(1);
      expect(r.text.length, name).toBeLessThanOrEqual(160);
    }
    expect(texts.receipt_issued.text).toBe('Kamal Physics: LKR 2,500.00 received for Nimali Perera. Receipt KPH-R-26-00012. Thank you.');
    expect(texts.fee_reminder_before.text).toContain("Nimali Perera's Oct 2026 fee of LKR 2,500 is due on 5 Oct");
    expect(texts.slip_rejected.text).toContain('(Amount does not match)');
  });

  it('falls back to English for si and ta and never machine-translates', () => {
    const en = renderSmsTemplate('slip_approved', { institute: I, months: 'Oct 2026', receiptNo: 'R-1' });
    expect(renderSmsTemplate('slip_approved', { institute: I, months: 'Oct 2026', receiptNo: 'R-1' }, 'si')).toEqual(en);
    expect(renderSmsTemplate('slip_approved', { institute: I, months: 'Oct 2026', receiptNo: 'R-1' }, 'ta')).toEqual(en);
  });

  it('caps variables so a long reason or name cannot multiply the price', () => {
    const r = renderSmsTemplate('slip_rejected', { institute: 'X'.repeat(200), reason: `${'long '.repeat(100)}\nnewline` });
    expect(r.text).not.toContain('\n');
    expect(r.segments).toBeLessThanOrEqual(2);
  });

  it('bills Sinhala text as UCS-2 (70 characters per segment) on the real text', () => {
    const r = renderSmsTemplate('receipt_issued', { institute: 'කමල් භෞතික විද්‍යාව', student: 'නිමලි පෙරේරා', amountCents: 250_000, receiptNo: 'R-26-00001' });
    expect(r.segments).toBe(smsSegments(r.text));
    expect(r.segments).toBeGreaterThan(1);
    expect(r.segments * SMS_SEGMENT_PRICE_CENTS).toBeGreaterThan(SMS_SEGMENT_PRICE_CENTS);
  });

  it('labels months and days without locale data', () => {
    expect(monthLabel('2026-10')).toBe('Oct 2026');
    expect(dayLabel('2026-10-05')).toBe('5 Oct');
  });
});

describe('business-date helpers for reminders (Asia/Colombo)', () => {
  it('addDays crosses month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('the Colombo date flips at 18:30 UTC, not at UTC midnight', () => {
    expect(calendarDate(new Date('2026-10-04T18:29:00Z'))).toBe('2026-10-04');
    expect(calendarDate(new Date('2026-10-04T18:31:00Z'))).toBe('2026-10-05');
  });
});
