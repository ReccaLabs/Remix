'use client';
import { Button } from '@remix/ui';
import type { StudentFees } from '@remix/types/api';
import { ReceiptText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { createBrowserApi } from '@/lib/browser-api';
import { FeeError, feeFailure, type FeeFailure } from './fee-error';
import { ManualPaymentDialog } from './manual-payment-dialog';
import { OpenMonths } from './open-months';
import { PaymentHistory } from './payment-history';

export function ProfilePayments({ initial, studentId, canCollect }: { initial: StudentFees | null; studentId: string; canCollect: boolean }) {
  const t = useTranslations('fees'); const [fees, setFees] = useState(initial);
  const [open, setOpen] = useState(false); const [failure, setFailure] = useState<FeeFailure | null>(initial ? null : 'load');
  const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(false);
  async function reload() {
    setBusy(true);
    try { setFees(await createBrowserApi().api.call('studentFees', { params: { id: studentId } })); setFailure(null); }
    catch (err) { setFailure(feeFailure(err)); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-5">
    <FeeError failure={failure} />
    {failure ? <Button size="lg" type="button" variant="secondary" loading={busy} onClick={() => void reload()}>{t('retry')}</Button> : null}
    {saved ? <p role="status" className="m-0 text-success-ink">{t('saved')}</p> : null}
    {fees ? <>
      {canCollect ? <div><Button size="lg" type="button" disabled={busy || fees.openLines.length === 0} onClick={() => setOpen(true)}><ReceiptText aria-hidden size={18} />{t('record')}</Button></div> : null}
      <OpenMonths lines={fees.openLines} /><PaymentHistory payments={fees.payments} admin />
      {open ? <ManualPaymentDialog initial={fees} open onClose={() => setOpen(false)} onSaved={() => { setSaved(true); void reload(); }} /> : null}
    </> : null}
  </div>;
}
