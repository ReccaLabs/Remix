import { smsSegments } from '@remix/types/api';
import { formatLKR } from '@remix/types/money';

/**
 * MSG-04 system SMS templates. English is the reference; Sinhala and Tamil fall back to it until
 * natively reviewed text exists (never machine-translated, CLAUDE.md). Texts are kept short:
 * English with plain ASCII names is a single 160-character segment, and every variable is
 * trimmed and capped so one long name cannot silently multiply the price.
 */
export const SMS_TEMPLATES = [
  'receipt_issued',
  'slip_approved',
  'slip_rejected',
  'fee_reminder_before',
  'fee_reminder_overdue',
] as const;
export type SmsTemplate = (typeof SMS_TEMPLATES)[number];

interface FeeReminderVars {
  institute: string;
  student: string;
  /** `2026-10` */
  month: string;
  amountCents: number;
  /** `2026-10-05` */
  dueOn: string;
}

export interface SmsTemplateVars {
  receipt_issued: { institute: string; student: string; amountCents: number; receiptNo: string };
  slip_approved: { institute: string; months: string; receiptNo: string };
  slip_rejected: { institute: string; reason: string };
  fee_reminder_before: FeeReminderVars;
  fee_reminder_overdue: FeeReminderVars;
}

type Renderers = { [T in SmsTemplate]: (v: SmsTemplateVars[T]) => string };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-10` -> `Oct 2026` (fixed table: independent of the server's ICU data). */
export function monthLabel(month: string): string {
  const [year, m] = month.split('-');
  return `${MONTHS[Number(m) - 1] ?? m ?? ''} ${year ?? ''}`.trim();
}
/** `2026-10-05` -> `5 Oct`. */
export function dayLabel(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? m ?? ''}`;
}

/** One line, no control characters, capped. */
function clean(value: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}.` : flat;
}

const EN: Renderers = {
  receipt_issued: (v) =>
    `${clean(v.institute, 28)}: ${formatLKR(v.amountCents, { exact: true })} received for ${clean(v.student, 24)}. Receipt ${clean(v.receiptNo, 24)}. Thank you.`,
  slip_approved: (v) =>
    `${clean(v.institute, 28)}: Your bank slip for ${clean(v.months, 30)} was approved. Receipt ${clean(v.receiptNo, 24)}.`,
  slip_rejected: (v) =>
    `${clean(v.institute, 28)}: Your bank slip was not accepted (${clean(v.reason, 60)}). Please upload it again.`,
  fee_reminder_before: (v) =>
    `${clean(v.institute, 28)}: ${clean(v.student, 24)}'s ${monthLabel(v.month)} fee of ${formatLKR(v.amountCents)} is due on ${dayLabel(v.dueOn)}. Please pay on time.`,
  fee_reminder_overdue: (v) =>
    `${clean(v.institute, 28)}: ${clean(v.student, 24)}'s ${monthLabel(v.month)} fee of ${formatLKR(v.amountCents)} was due on ${dayLabel(v.dueOn)} and is unpaid. Please pay soon.`,
};

const BY_LOCALE: Readonly<Record<string, Renderers>> = { en: EN };

export interface RenderedSms {
  text: string;
  segments: number;
}

/** Render a template; unknown or unreviewed locales (si, ta) use the English text. */
export function renderSmsTemplate<T extends SmsTemplate>(
  template: T,
  vars: SmsTemplateVars[T],
  locale = 'en',
): RenderedSms {
  const renderers = BY_LOCALE[locale] ?? EN;
  const text = renderers[template](vars);
  return { text, segments: smsSegments(text) };
}
