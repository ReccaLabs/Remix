'use client';
import { Button, Field, Input, StatusBadge, type StatusTone } from '@remix/ui';
import {
  ApiError,
  SLIP_CONTENT_TYPES,
  SLIP_MAX_BYTES,
  submitSlipSchema,
  type InvoiceLine,
  type MyFeesResponse,
  type SlipStatus,
} from '@remix/types/api';
import { formatLKR } from '@remix/types/money';
import { Upload } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { createBrowserApi } from '@/lib/browser-api';
import { cashCents, feeBusinessDate } from '@/lib/fees-money';
import { FormAlert } from '@/components/form-alert';
import { OpenMonths } from './open-months';

type MySlip = MyFeesResponse['slips'][number];
type SlipFailure = 'validation' | 'upload' | 'expired' | 'paid' | 'conflict' | 'rateLimited' | 'network';

const TONES: Record<SlipStatus, StatusTone> = {
  processing: 'warning',
  submitted: 'warning',
  approved: 'success',
  rejected: 'danger',
  superseded: 'neutral',
};

/** Browsers report HEIC inconsistently (often an empty type); fall back to the extension. */
export function slipContentType(file: File): (typeof SLIP_CONTENT_TYPES)[number] | null {
  const declared = SLIP_CONTENT_TYPES.find((type) => type === file.type);
  if (declared) return declared;
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'heif') return 'image/heif';
  return null;
}

function slipFailure(error: unknown): SlipFailure {
  if (!(error instanceof ApiError)) return 'network';
  switch (error.problem.code) {
    case 'VALIDATION_FAILED': return 'validation';
    case 'NOT_FOUND': return 'expired';
    case 'ALREADY_PAID': return 'paid';
    case 'CONFLICT': return 'conflict';
    case 'RATE_LIMITED': return 'rateLimited';
    default: return 'network';
  }
}

/**
 * FEE-05 (6c/6e): pick months, photograph the slip, send it. The photo goes straight to private
 * storage with the presigned PUT (type and exact size are bound by the signature); the API only
 * gets the upload id. Status words, never colour alone.
 */
export function SlipUpload({ lines, slips }: { lines: InvoiceLine[]; slips: MyFeesResponse['slips'] }) {
  const t = useTranslations('fees.slips');
  const format = useFormatter();
  const open = lines.filter((l) => !l.slipWaiting);
  const [selected, setSelected] = useState<string[]>(open.map((l) => l.id));
  const total = lines.filter((l) => selected.includes(l.id)).reduce((sum, l) => sum + l.openCents, 0);
  const [amount, setAmount] = useState(total ? (total / 100).toFixed(2) : '');
  const [reference, setReference] = useState('');
  const [slipDate, setSlipDate] = useState(feeBusinessDate());
  const [file, setFile] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState<'photoType' | 'photoTooLarge' | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<SlipFailure | null>(null);
  const [sent, setSent] = useState<MySlip[]>([]);
  const [done, setDone] = useState(false);
  const inFlight = useRef(false);
  const all = [...sent, ...slips.filter((s) => !sent.some((n) => n.id === s.id))];

  function choose(next: File | null) {
    setFile(null);
    setPhotoError(null);
    if (!next) return;
    if (!slipContentType(next)) setPhotoError('photoType');
    else if (next.size > SLIP_MAX_BYTES || next.size < 1) setPhotoError('photoTooLarge');
    else setFile(next);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    const contentType = file ? slipContentType(file) : null;
    const amountCents = cashCents(amount);
    const draft = { uploadId: '00000000-0000-4000-8000-000000000000', lineIds: selected, amountCents, reference: reference.trim(), slipDate };
    if (!file || !contentType || !submitSlipSchema.safeParse(draft).success || slipDate > feeBusinessDate()) {
      setFailure('validation');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const { api } = createBrowserApi();
      const upload = await api.call('requestSlipUpload', { contentType, sizeBytes: file.size });
      let put: Response;
      try {
        put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: file, credentials: 'omit' });
      } catch {
        setFailure('upload');
        return;
      }
      if (!put.ok) {
        setFailure('upload');
        return;
      }
      const slip = await api.call('submitSlip', { ...draft, uploadId: upload.uploadId, amountCents: amountCents ?? 0 });
      setSent((prev) => [
        { id: slip.id, status: slip.status, submittedAt: slip.submittedAt, amountCents: slip.amountCents, reference: slip.reference, rejectReason: null },
        ...prev,
      ]);
      setDone(true);
    } catch (err) {
      setFailure(slipFailure(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {open.length > 0 ? (
        <section aria-labelledby="slip-upload-title" className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
          <h2 id="slip-upload-title" className="m-0 flex items-center gap-2 text-base font-semibold">
            <Upload aria-hidden size={18} />
            {t('uploadTitle')}
          </h2>
          {done ? (
            <div role="status" className="flex flex-col gap-3">
              <p className="m-0 font-semibold">{t('sentTitle')}</p>
              <p className="m-0 text-muted">{t('sentBody')}</p>
              <Button type="button" variant="secondary" onClick={() => { setDone(false); setFile(null); setReference(''); }}>
                {t('sendAnother')}
              </Button>
            </div>
          ) : (
            <form noValidate onSubmit={(e) => void send(e)} className="flex flex-col gap-4">
              <p className="m-0 text-sm text-muted">{t('uploadHint')}</p>
              {failure ? <FormAlert>{t(`errors.${failure}`)}</FormAlert> : null}
              <OpenMonths
                title={t('months')}
                lines={open}
                selected={selected}
                disabled={busy}
                onSelect={(ids) => {
                  setSelected(ids);
                  const sum = open.filter((l) => ids.includes(l.id)).reduce((n, l) => n + l.openCents, 0);
                  setAmount(sum ? (sum / 100).toFixed(2) : '');
                }}
              />
              <Field label={t('photo')} hint={photoError ? undefined : t('photoHint')} error={photoError ? t(photoError) : undefined}>
                <Input
                  type="file"
                  accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif"
                  disabled={busy}
                  onChange={(e) => choose(e.target.files?.[0] ?? null)}
                />
              </Field>
              <Field label={t('amount')}>
                <Input inputMode="decimal" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Field label={t('reference')}>
                <Input value={reference} maxLength={40} autoComplete="off" disabled={busy} onChange={(e) => setReference(e.target.value)} />
              </Field>
              <Field label={t('slipDate')}>
                <Input type="date" value={slipDate} max={feeBusinessDate()} disabled={busy} onChange={(e) => setSlipDate(e.target.value)} />
              </Field>
              <Button size="lg" type="submit" loading={busy} disabled={selected.length === 0}>
                {t('send')}
              </Button>
              <p className="m-0 text-sm text-muted">{t('officeHours')}</p>
            </form>
          )}
        </section>
      ) : null}
      {all.length > 0 ? (
        <section aria-labelledby="my-slips-title" className="overflow-hidden rounded-lg border border-line bg-surface">
          <h2 id="my-slips-title" className="m-0 border-b border-line px-4 py-3 text-base font-semibold">{t('yours')}</h2>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {all.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block font-medium tabular-nums">{formatLKR(s.amountCents, { exact: true })}</span>
                  <span className="block break-words text-sm text-muted">
                    {s.reference} · {format.dateTime(new Date(s.submittedAt), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Colombo' })}
                  </span>
                  {s.status === 'rejected' && s.rejectReason ? (
                    <span className="block text-sm">{t('rejectedBecause', { reason: s.rejectReason })}</span>
                  ) : null}
                </span>
                <StatusBadge tone={TONES[s.status]}>{t(`status.${s.status}`)}</StatusBadge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
