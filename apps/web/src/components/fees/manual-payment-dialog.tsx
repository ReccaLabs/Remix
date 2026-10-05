'use client';
import { Button, Field, Input } from '@remix/ui';
import { MANUAL_PAYMENT_KINDS, manualPaymentSchema, type ManualPaymentRequest, type StudentFees } from '@remix/types/api';
import { formatLKR } from '@remix/types/money';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { Dialog } from '@/components/people/dialog';
import { Select } from '@/components/people/select';
import { createBrowserApi } from '@/lib/browser-api';
import { feeBusinessDate } from '@/lib/fees-money';
import { FeeError, feeFailure, type FeeFailure } from './fee-error';
import { OpenMonths } from './open-months';

export function ManualPaymentDialog({ initial, open, onClose, onSaved }: { initial: StudentFees; open: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('fees');
  const [kind, setKind] = useState<ManualPaymentRequest['kind']>('bank_transfer');
  const [reference, setReference] = useState(''); const [receivedOn, setReceivedOn] = useState(feeBusinessDate());
  const [note, setNote] = useState(''); const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [failure, setFailure] = useState<FeeFailure | null>(null);
  const inFlight = useRef(false); const retry = useRef<{ signature: string; body: ManualPaymentRequest } | null>(null);
  const lines = initial.openLines.filter(l => selected.includes(l.id)); const total = lines.reduce((sum, l) => sum + l.openCents, 0);
  const oldest = lines.map(l => l.month).sort()[0]; const min = oldest ? `${Number(oldest.slice(0, 4)) - 1}${oldest.slice(4)}` : undefined;
  async function save(e: FormEvent) {
    e.preventDefault(); if (inFlight.current) return;
    const fields = { studentId: initial.studentId, lineIds: selected, kind, reference: reference.trim(), receivedOn, note: note.trim() || undefined };
    const signature = JSON.stringify(fields);
    const body = retry.current?.signature === signature ? retry.current.body : { ...fields, idempotencyKey: crypto.randomUUID() };
    const valid = manualPaymentSchema.safeParse(body);
    if (!valid.success || receivedOn > feeBusinessDate() || (min && receivedOn < min)) { setFailure('validation'); return; }
    retry.current = { signature, body: valid.data }; setBusy(true); inFlight.current = true; setFailure(null);
    try { await createBrowserApi().api.call('recordManualPayment', valid.data); onSaved(); onClose(); }
    catch (err) { setFailure(feeFailure(err)); }
    finally { setBusy(false); inFlight.current = false; }
  }
  return <Dialog open={open} title={t('manualTitle')} description={t('manualHint')} onClose={onClose} busy={busy}>
    <form noValidate onSubmit={e => void save(e)} className="flex flex-col gap-4">
      <p className="m-0 font-semibold">{initial.displayName} · {initial.studentNo}</p>
      <FeeError failure={failure} />
      <OpenMonths lines={initial.openLines} selected={selected} onSelect={setSelected} disabled={busy} />
      <div className="flex justify-between gap-3"><span>{t('total')}</span><output className="font-semibold tabular-nums">{formatLKR(total, { exact: true })}</output></div>
      <Field label={t('kind')}><Select value={kind} disabled={busy} onChange={e => { const value = MANUAL_PAYMENT_KINDS.find(k => k === e.target.value); if (value) setKind(value); }}>{MANUAL_PAYMENT_KINDS.map(k => <option key={k} value={k}>{t(`kinds.${k}`)}</option>)}</Select></Field>
      <Field label={t('reference')}><Input value={reference} maxLength={80} disabled={busy} onChange={e => setReference(e.target.value)} /></Field>
      <Field label={t('receivedOn')}><Input type="date" value={receivedOn} min={min} max={feeBusinessDate()} disabled={busy} onChange={e => setReceivedOn(e.target.value)} /></Field>
      <Field label={t('note')}><Input value={note} maxLength={300} disabled={busy} onChange={e => setNote(e.target.value)} /></Field>
      <div className="flex flex-wrap gap-2"><Button size="lg" type="submit" loading={busy} disabled={selected.length === 0}>{t('record')}</Button><Button size="lg" type="button" variant="secondary" disabled={busy} onClick={onClose}>{t('cancel')}</Button></div>
    </form>
  </Dialog>;
}
