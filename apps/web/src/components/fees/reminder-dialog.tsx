'use client';
import { Button, Field, useToast } from '@remix/ui';
import { ApiError, type ReminderPreview, type ReminderTarget } from '@remix/types/api';
import { formatLKR } from '@remix/types/money';
import { AlertTriangle } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { FormAlert } from '@/components/form-alert';
import { Dialog } from '@/components/people/dialog';
import { Select } from '@/components/people/select';
import { createBrowserApi } from '@/lib/browser-api';

type Failure = 'balance' | 'forbidden' | 'validation' | 'rateLimited' | 'network';
function failureOf(error: unknown): Failure {
  if (!(error instanceof ApiError)) return 'network';
  switch (error.problem.code) {
    case 'INSUFFICIENT_BALANCE': return 'balance';
    case 'FORBIDDEN': return 'forbidden';
    case 'VALIDATION_FAILED': return 'validation';
    case 'RATE_LIMITED': return 'rateLimited';
    default: return 'network';
  }
}

export interface ReminderDialogProps {
  open: boolean;
  onClose: () => void;
  /** Months to choose from (`YYYY-MM-01`, newest first). */
  months: readonly string[];
  classes: readonly { id: string; name: string }[];
  defaultTarget: ReminderTarget;
  /** The owner can buy SMS: show the way there when the wallet is short. */
  smsSettingsHref: string | null;
  onSent: () => void;
}

/**
 * FEE-02 "Send reminder SMS to N unpaid": cost preview first (who, how many segments, what it
 * costs, what the wallet holds), then send with the same target. The idempotency key is kept
 * while the target is unchanged, so a retry after a network error never texts anyone twice.
 */
export function ReminderDialog({ open, onClose, months, classes, defaultTarget, smsSettingsHref, onSent }: ReminderDialogProps) {
  const t = useTranslations('fees.reminders');
  const format = useFormatter();
  const { toast } = useToast();
  const [month, setMonth] = useState(defaultTarget.month);
  const [filter, setFilter] = useState<ReminderTarget['filter']>(defaultTarget.filter);
  const [classId, setClassId] = useState(defaultTarget.classId ?? '');
  // The latest preview answer, tagged with the target it belongs to: a stale answer is ignored.
  const [answer, setAnswer] = useState<{ signature: string; preview: ReminderPreview | null; failure: Failure | null } | null>(null);
  const [sendFailure, setSendFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const target: ReminderTarget = { month, filter, ...(classId ? { classId } : {}) };
  const signature = JSON.stringify(target);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    createBrowserApi().api.call('previewReminders', JSON.parse(signature) as ReminderTarget).then(
      (result) => { if (!cancelled) setAnswer({ signature, preview: result, failure: null }); },
      (error: unknown) => { if (!cancelled) setAnswer({ signature, preview: null, failure: failureOf(error) }); },
    );
    return () => { cancelled = true; };
  }, [open, signature]);

  const current = answer?.signature === signature ? answer : null;
  const preview = current?.preview ?? null;
  const failure = sendFailure ?? current?.failure ?? null;
  const short = preview !== null && preview.costCents > preview.balanceCents;
  const ready = preview !== null && preview.recipients > 0 && !short;

  async function send() {
    if (inFlight.current || !ready) return;
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
    inFlight.current = true;
    setBusy(true);
    setSendFailure(null);
    try {
      const result = await createBrowserApi().api.call('sendReminders', { ...target, idempotencyKey: attempt.current.key });
      attempt.current = null;
      toast({ tone: 'success', title: t('sent'), description: t('sentBody', { count: result.queued, cost: formatLKR(result.costCents, { exact: true }) }) });
      onSent();
      onClose();
    } catch (error) {
      setSendFailure(failureOf(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const monthLabel = (value: string) => format.dateTime(new Date(value), { month: 'long', year: 'numeric', timeZone: 'Asia/Colombo' });
  return (
    <Dialog open={open} title={t('title')} description={t('description')} onClose={onClose} busy={busy}>
      <div className="flex flex-col gap-4">
        {failure ? <FormAlert>{t(`errors.${failure}`)}</FormAlert> : null}
        <Field label={t('month')}>
          <Select value={month} disabled={busy} onChange={(e) => { setMonth(e.target.value); setSendFailure(null); }}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </Select>
        </Field>
        <Field label={t('audience')}>
          <Select value={filter} disabled={busy} onChange={(e) => { setFilter(e.target.value === 'overdue' ? 'overdue' : 'unpaid'); setSendFailure(null); }}>
            <option value="unpaid">{t('audienceUnpaid')}</option>
            <option value="overdue">{t('audienceOverdue')}</option>
          </Select>
        </Field>
        <Field label={t('class')}>
          <Select value={classId} disabled={busy} onChange={(e) => { setClassId(e.target.value); setSendFailure(null); }}>
            <option value="">{t('allClasses')}</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <div aria-live="polite" className="flex flex-col gap-3 rounded-md border border-line bg-canvas p-3">
          {current === null && !failure ? <p className="m-0 text-muted">{t('calculating')}</p> : null}
          {preview ? (
            <>
              <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">{t('recipients')}</dt><dd className="m-0 text-end font-semibold tabular-nums">{preview.recipients}</dd>
                <dt className="text-muted">{t('segments')}</dt><dd className="m-0 text-end tabular-nums">{preview.segments}</dd>
                <dt className="text-muted">{t('cost')}</dt><dd className="m-0 text-end font-semibold tabular-nums">{formatLKR(preview.costCents, { exact: true })}</dd>
                <dt className="text-muted">{t('balance')}</dt><dd className="m-0 text-end tabular-nums">{formatLKR(preview.balanceCents, { exact: true })}</dd>
              </dl>
              {preview.recipients === 0 ? <p className="m-0 text-muted">{t('none')}</p> : (
                <p className="m-0 text-sm"><span className="block text-muted">{t('sample')}</span>{preview.sampleText}</p>
              )}
              {short ? (
                <p role="alert" className="m-0 flex items-start gap-2 text-danger-ink">
                  <AlertTriangle aria-hidden size={16} className="mt-1 shrink-0" />
                  <span>{t('insufficient')}{' '}{smsSettingsHref ? <a href={smsSettingsHref} className="font-semibold underline">{t('buyMore')}</a> : null}</span>
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="lg" type="button" loading={busy} disabled={!ready} onClick={() => void send()}>{t('send', { count: preview?.recipients ?? 0 })}</Button>
          <Button size="lg" type="button" variant="secondary" disabled={busy} onClick={onClose}>{t('cancel')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
