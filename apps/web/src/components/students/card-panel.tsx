'use client';
import { ApiError, type CardFormat, type StudentCard } from '@remix/types/api';
import { Button, ConfirmDialog, Field, Input, StatusBadge } from '@remix/ui';
import { CreditCard, Printer, Radio, Ban } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createBrowserApi } from '@/lib/browser-api';
import { noHardware, scanNfc, subscribeHardware, supportsNfc } from '@/lib/card-nfc';

export function CardPanel({
  studentId,
  archived,
  canWrite,
  initial,
}: {
  studentId: string;
  archived: boolean;
  canWrite: boolean;
  initial: StudentCard[] | null;
}) {
  const t = useTranslations('students.cards');
  const router = useRouter();
  const format = useFormatter();
  const [cards, setCards] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<
    'loadError' | 'actionError' | 'conflict' | 'validation' | 'reasonError' | 'tapError' | null
  >(initial === null ? 'loadError' : null);
  const [dialog, setDialog] = useState<{
    action: 'order' | 'activate' | 'revoke';
    card?: StudentCard;
  } | null>(null);
  const [qr, setQr] = useState(false);
  const [nfc, setNfc] = useState(false);
  const [uid, setUid] = useState('');
  const [reason, setReason] = useState('');
  const [tapping, setTapping] = useState(false);
  const inFlight = useRef(false);
  const nfcScan = useRef<AbortController | null>(null);
  const nfcSupported = useSyncExternalStore(subscribeHardware, supportsNfc, noHardware);
  useEffect(() => () => nfcScan.current?.abort(), []);
  const active = cards?.find((c) => c.status === 'active');
  const ordered = cards?.find((c) => c.status === 'ordered');
  const date = (value: string) =>
    format.dateTime(new Date(value), { timeZone: 'Asia/Colombo', dateStyle: 'medium' });
  function close() {
    nfcScan.current?.abort();
    setTapping(false);
    setDialog(null);
    setUid('');
    setReason('');
  }
  async function reload() {
    setBusy(true);
    setError(null);
    try {
      setCards(
        (await createBrowserApi().api.call('listStudentCards', { params: { id: studentId } }))
          .items,
      );
    } catch {
      setError('loadError');
    } finally {
      setBusy(false);
    }
  }
  async function mutate(action: 'temporary' | 'order' | 'activate' | 'revoke') {
    if (inFlight.current) return;
    if (action === 'revoke' && (reason.trim().length < 3 || reason.trim().length > 200)) {
      setError('reasonError');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const print = action === 'temporary' ? window.open('about:blank', '_blank') : null;
    if (print) print.opener = null;
    try {
      const api = createBrowserApi().api;
      if (action === 'temporary') {
        await api.call('issueStudentCard', { kind: 'temporary' }, { params: { id: studentId } });
        const href = `/admin/students/${studentId}/card/print`;
        if (print) print.location.href = href;
        else router.push(href);
      } else if (action === 'order') {
        const formats: CardFormat[] = ['barcode'];
        if (qr) formats.push('qr');
        if (nfc) formats.push('nfc');
        await api.call(
          'issueStudentCard',
          { kind: 'permanent', formats },
          { params: { id: studentId } },
        );
      } else if (dialog?.card) {
        if (action === 'activate')
          await api.call('activateStudentCard', uid.trim() ? { nfcUid: uid } : {}, {
            params: { id: dialog.card.id },
          });
        else await api.call('revokeStudentCard', { reason }, { params: { id: dialog.card.id } });
      }
      close();
      setCards((await api.call('listStudentCards', { params: { id: studentId } })).items);
    } catch (err) {
      print?.close();
      setError(
        err instanceof ApiError && err.status === 409
          ? 'conflict'
          : err instanceof ApiError && err.status === 400
            ? 'validation'
            : 'actionError',
      );
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  async function tap() {
    nfcScan.current?.abort();
    const scan = new AbortController();
    nfcScan.current = scan;
    setTapping(true);
    try {
      await scanNfc(
        scan.signal,
        (_value, serial) => {
          setUid(serial);
          scan.abort();
          setTapping(false);
        },
        () => {
          setError('tapError');
          scan.abort();
          setTapping(false);
        },
      );
    } catch {
      if (!scan.signal.aborted) {
        setError('tapError');
        setTapping(false);
      }
    }
  }
  function cardDetails(card: StudentCard) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{t(card.kind)}</span>
          <StatusBadge
            tone={
              card.status === 'active'
                ? 'success'
                : card.status === 'ordered'
                  ? 'warning'
                  : 'danger'
            }
          >
            {t(card.status)}
          </StatusBadge>
        </div>
        <p className="m-0 font-mono text-lg font-semibold break-all">{card.code}</p>
        <p className="m-0 text-sm text-muted">{card.formats.map((f) => t(f)).join(' / ')}</p>
        {card.status === 'ordered' ? <p className="m-0 text-warning-ink">{t('printing')}</p> : null}
        <p className="m-0 text-sm text-muted">{t('issued', { date: date(card.issuedAt) })}</p>
        {card.activatedAt ? (
          <p className="m-0 text-sm text-muted">
            {t('activated', { date: date(card.activatedAt) })}
          </p>
        ) : null}
        {card.revokedAt ? (
          <p className="m-0 text-sm text-muted">
            {t('revokedDate', { date: date(card.revokedAt) })}: {card.revokeReason}
          </p>
        ) : null}
        {card.nfcUidHint ? (
          <p className="m-0 font-mono text-sm">
            {t('nfc')}: {card.nfcUidHint}
          </p>
        ) : null}
        {canWrite && card.status !== 'revoked' ? (
          <div className="flex flex-wrap gap-2">
            {card.status === 'ordered' ? (
              <Button
                size="lg"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setDialog({ action: 'activate', card });
                }}
              >
                <CreditCard aria-hidden size={18} />
                {t('handOver')}
              </Button>
            ) : null}
            <Button
              size="lg"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setError(null);
                setDialog({ action: 'revoke', card });
              }}
            >
              <Ban aria-hidden size={18} />
              {t('revoke')}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <section
      aria-label={t('title')}
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
    >
      <h2 className="m-0 text-lg font-semibold">{t('title')}</h2>
      {error && !dialog ? (
        <p role="alert" className="m-0 text-danger-ink">
          {t(error)}
        </p>
      ) : null}
      {cards === null ? (
        <Button size="lg" variant="secondary" loading={busy} onClick={() => void reload()}>
          {t('retry')}
        </Button>
      ) : (
        <>
          {!active && !ordered ? <p className="m-0 text-muted">{t('none')}</p> : null}
          <div className="grid gap-4 md:grid-cols-2">
            {active ? cardDetails(active) : null}
            {ordered ? cardDetails(ordered) : null}
          </div>
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="lg"
                variant="secondary"
                disabled={busy || archived}
                onClick={() => void mutate('temporary')}
              >
                <Printer aria-hidden size={18} />
                {t('printTemporary')}
              </Button>
              <Button
                size="lg"
                disabled={busy || archived || Boolean(ordered)}
                onClick={() => {
                  setQr(false);
                  setNfc(false);
                  setError(null);
                  setDialog({ action: 'order' });
                }}
              >
                <CreditCard aria-hidden size={18} />
                {t('orderPermanent')}
              </Button>
            </div>
          ) : null}
          {archived ? <p className="m-0 text-warning-ink">{t('archived')}</p> : null}
          {cards.some((c) => c.status === 'revoked') ? (
            <details>
              <summary className="min-h-11 cursor-pointer py-3 font-semibold">
                {t('history')}
              </summary>
              <ol className="m-0 flex list-none flex-col gap-4 p-0">
                {cards
                  .filter((c) => c.status === 'revoked')
                  .map((card) => (
                    <li key={card.id} className="border-t border-line pt-4">
                      {cardDetails(card)}
                    </li>
                  ))}
              </ol>
            </details>
          ) : null}
        </>
      )}
      <ConfirmDialog
        open={dialog !== null}
        title={t(
          dialog?.action === 'order'
            ? 'orderPermanent'
            : dialog?.action === 'activate'
              ? 'handOver'
              : 'revoke',
        )}
        description={
          dialog?.action === 'order'
            ? t('orderHint')
            : dialog?.action === 'activate'
              ? t('handoverConfirm')
              : dialog?.card?.code
        }
        confirmLabel={t(
          dialog?.action === 'order'
            ? 'orderPermanent'
            : dialog?.action === 'activate'
              ? 'handOver'
              : 'revoke',
        )}
        cancelLabel={t('cancel')}
        variant={dialog?.action === 'revoke' ? 'destructive' : 'default'}
        confirming={busy}
        onCancel={close}
        onConfirm={() => {
          if (dialog) void mutate(dialog.action);
        }}
      >
        {dialog?.action === 'order' ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="font-semibold">{t('formats')}</legend>
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" checked readOnly disabled />
              {t('barcode')}
            </label>
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" checked={qr} onChange={(e) => setQr(e.target.checked)} />
              {t('qr')}
            </label>
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" checked={nfc} onChange={(e) => setNfc(e.target.checked)} />
              {t('nfc')}
            </label>
          </fieldset>
        ) : null}
        {dialog?.action === 'activate' && dialog.card?.formats.includes('nfc') ? (
          <div className="flex flex-col gap-3">
            <Field label={t('uid')} hint={t('uidHint')}>
              <Input value={uid} maxLength={64} onChange={(e) => setUid(e.target.value)} />
            </Field>
            {nfcSupported ? (
              <Button
                size="lg"
                type="button"
                variant="secondary"
                onClick={() => void tap()}
                disabled={tapping}
              >
                <Radio aria-hidden size={18} />
                {t('tap')}
              </Button>
            ) : null}
            {tapping ? <p role="status">{t('tapWaiting')}</p> : null}
          </div>
        ) : null}
        {dialog?.action === 'revoke' ? (
          <Field label={t('reason')} hint={t('reasonHint')}>
            <Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          </Field>
        ) : null}
        {error && dialog ? (
          <p role="alert" className="m-0 text-danger-ink">
            {t(error)}
          </p>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}
