'use client';
import { Button, ConfirmDialog, Field, Input, buttonClass } from '@remix/ui';
import type { Payment } from '@remix/types/api';
import { formatLKR } from '@remix/types/money';
import { Printer, Undo2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Dialog } from '@/components/people/dialog';
import { createBrowserApi } from '@/lib/browser-api';
import { FeeError, feeFailure, type FeeFailure } from './fee-error';
import { PaymentStatus } from './payment-status';
import { ReceiptDownload } from './receipt-download';

export function PaymentDrawer({ id, owner, onClose, onChanged }: { id: string | null; owner: boolean; onClose: () => void; onChanged: () => void }) {
  const t = useTranslations('fees'); const format = useFormatter();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [failure, setFailure] = useState<FeeFailure | null>(null);
  const [confirm, setConfirm] = useState(false); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (id) void createBrowserApi().api.call('getPayment', { params: { id } }).then(p => {
      if (active) { setPayment(p); setFailure(null); }
    }).catch(err => { if (active) setFailure(feeFailure(err)); });
    return () => { active = false; };
  }, [id]);
  async function reverse() {
    if (!payment || reason.trim().length < 3) { setFailure('validation'); setConfirm(false); return; }
    setBusy(true);
    try {
      await createBrowserApi().api.call('reversePayment', { reason: reason.trim() }, { params: { id: payment.id } });
      setConfirm(false); onChanged(); onClose();
    } catch (err) { setFailure(feeFailure(err)); setConfirm(false); }
    finally { setBusy(false); }
  }
  const current = payment?.id === id ? payment : null;
  return <>
    <Dialog variant="drawer" open={id !== null} title={t('detail')} onClose={onClose} busy={busy}>
      <FeeError failure={failure} />
      {!current && !failure ? <p role="status">{t('loading')}</p> : null}
      {current ? <>
        <p className="m-0 text-lg font-semibold">{current.studentName}</p>
        <p className="m-0 text-2xl font-semibold tabular-nums">{formatLKR(current.amountCents, { exact: true })}</p>
        <PaymentStatus payment={current} />
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <dt className="text-muted">{t('date')}</dt><dd className="m-0">{format.dateTime(new Date(current.receivedAt), { dateStyle: 'medium', timeZone: 'Asia/Colombo' })}</dd>
          <dt className="text-muted">{t('method')}</dt><dd className="m-0">{t(`methods.${current.method}`)}</dd>
          <dt className="text-muted">{t('receivedBy')}</dt><dd className="m-0">{current.receivedByName}</dd>
          {current.reference ? <><dt>{t('reference')}</dt><dd className="m-0 break-words">{current.reference}</dd></> : null}
          {current.note ? <><dt>{t('note')}</dt><dd className="m-0 break-words">{current.note}</dd></> : null}
        </dl>
        <ul className="m-0 list-none divide-y divide-line p-0">{current.lines.map(l => <li key={l.lineId} className="flex justify-between gap-3 py-3"><span>{l.className}<span className="block text-sm text-muted">{format.dateTime(new Date(l.month), { month: 'long', year: 'numeric' })}</span></span><span className="tabular-nums">{formatLKR(l.amountCents, { exact: true })}</span></li>)}</ul>
        {current.receiptId ? <div className="flex flex-wrap gap-2"><ReceiptDownload id={current.receiptId} /><a target="_blank" rel="noopener noreferrer" href={`/admin/receipts/${current.receiptId}/print`} className={buttonClass({ size: 'lg', variant: 'secondary' })}><Printer aria-hidden size={18} />{t('reprint')}</a></div> : null}
        {owner && current.method !== 'reversal' && !current.reversedByPaymentId ? <>
          <Field label={t('reason')}><Input value={reason} maxLength={300} onChange={e => setReason(e.target.value)} /></Field>
          <Button size="lg" type="button" variant="danger" disabled={reason.trim().length < 3} onClick={() => setConfirm(true)}><Undo2 aria-hidden size={18} />{t('reverse')}</Button>
        </> : null}
      </> : null}
      <Button size="lg" type="button" variant="secondary" onClick={onClose}>{t('close')}</Button>
    </Dialog>
    <ConfirmDialog open={confirm} title={t('reverseConfirm')} description={t('reverseDescription')} variant="destructive" confirming={busy} confirmLabel={t('reverse')} cancelLabel={t('cancel')} onConfirm={() => void reverse()} onCancel={() => setConfirm(false)} />
  </>;
}
