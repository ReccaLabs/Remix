'use client';
import { Button, Checkbox, EmptyState, Field, Input, StatusBadge } from '@remix/ui';
import { ApiError, type Slip } from '@remix/types/api';
import { formatLKR } from '@remix/types/money';
import { RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Dialog } from '@/components/people/dialog';
import { FormAlert } from '@/components/form-alert';
import { createBrowserApi } from '@/lib/browser-api';

const REASONS = ['amount', 'unclear', 'used', 'account'] as const;
type Reason = (typeof REASONS)[number];
type QueueFailure = 'load' | 'conflict' | 'duplicate' | 'paid' | 'network';
type Notice = 'approved' | 'rejected';

/** Keys only act outside form fields, without modifiers, and never while the reason dialog is open. */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/**
 * FEE-06 (11a/11b/11e): the cashier works through waiting slips oldest first, keyboard only —
 * A approve, R reject (reason dialog), S skip — and the queue advances by itself. The photo is
 * loaded through a short-lived signed URL fetched per slip (never stored); zoom and rotate are
 * view-only. Approve always pays the expected amount (ADR 0008 §5).
 */
export function SlipQueue({ initial }: { initial: Slip[] }) {
  const t = useTranslations('fees.slips');
  const format = useFormatter();
  const [items, setItems] = useState(initial);
  const [index, setIndex] = useState(0);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<Reason>('amount');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<QueueFailure | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const inFlight = useRef(false);
  const current = items.length ? items[Math.min(index, items.length - 1)] : undefined;

  const reload = useCallback(async () => {
    try {
      const page = await createBrowserApi().api.call('listSlips', { query: { status: 'submitted', page: 1, pageSize: 100 } });
      setItems(page.items);
      setIndex(0);
    } catch {
      setFailure('load');
    }
  }, []);

  /** Drop the reviewed slip; the next one slides into the same position (auto-advance). */
  const advance = useCallback((id: string) => {
    setConfirmDuplicate(false);
    setItems((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (next.length === 0) void reload();
      return next;
    });
  }, [reload]);

  const approve = useCallback(async () => {
    if (!current || inFlight.current) return;
    if (current.duplicateOf && !confirmDuplicate) { setFailure('duplicate'); return; }
    inFlight.current = true; setBusy(true); setFailure(null); setNotice(null);
    try {
      await createBrowserApi().api.call('approveSlip', { confirmDuplicate: Boolean(current.duplicateOf) && confirmDuplicate }, { params: { id: current.id } });
      setNotice('approved');
      advance(current.id);
    } catch (err) {
      const code = err instanceof ApiError ? err.problem.code : null;
      if (code === 'ALREADY_PAID') setFailure('paid');
      else if (code === 'CONFLICT' || code === 'NOT_FOUND') { setFailure('conflict'); advance(current.id); }
      else setFailure('network');
    } finally { inFlight.current = false; setBusy(false); }
  }, [advance, confirmDuplicate, current]);

  async function reject(e: FormEvent) {
    e.preventDefault();
    if (!current || inFlight.current) return;
    const text = [t(`reasons.${reason}`), note.trim()].filter(Boolean).join(': ').slice(0, 200);
    inFlight.current = true; setBusy(true); setFailure(null); setNotice(null);
    try {
      await createBrowserApi().api.call('rejectSlip', { reason: text }, { params: { id: current.id } });
      setRejecting(false); setNote(''); setNotice('rejected');
      advance(current.id);
    } catch (err) {
      const code = err instanceof ApiError ? err.problem.code : null;
      setRejecting(false);
      if (code === 'CONFLICT' || code === 'NOT_FOUND') { setFailure('conflict'); advance(current.id); }
      else setFailure('network');
    } finally { inFlight.current = false; setBusy(false); }
  }

  const skip = useCallback(() => {
    if (items.length < 2) return;
    setFailure(null); setNotice(null); setConfirmDuplicate(false);
    setIndex((i) => (Math.min(i, items.length - 1) + 1) % items.length);
  }, [items.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (rejecting || busy || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'a') { e.preventDefault(); void approve(); }
      else if (key === 'r' && current) { e.preventDefault(); setRejecting(true); }
      else if (key === 's') { e.preventDefault(); skip(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [approve, busy, current, rejecting, skip]);

  if (!current) {
    return <div className="flex flex-col gap-3">
      {notice ? <p role="status" className="m-0 font-medium">{t(notice)}</p> : null}
      {failure ? <FormAlert>{t(`queueErrors.${failure}`)}</FormAlert> : null}
      <EmptyState title={t('queueEmpty')} description={t('queueEmptyBody')} />
    </div>;
  }

  const position = Math.min(index, items.length - 1);
  const mismatch = current.amountCents !== current.expectedCents;
  const dateTime = (iso: string) => format.dateTime(new Date(iso), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Colombo' });

  return <div className="grid items-start gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
    <section aria-label={t('queueList')} className="hidden overflow-hidden rounded-lg border border-line bg-surface lg:block">
      <h2 className="m-0 flex justify-between border-b border-line px-4 py-3 text-base font-semibold"><span>{t('queueCount', { count: items.length })}</span><span className="text-sm font-normal text-muted">{t('oldestFirst')}</span></h2>
      <ol className="m-0 list-none divide-y divide-line p-0">{items.map((s, i) => <li key={s.id}>
        <button type="button" aria-current={i === position ? 'true' : undefined} onClick={() => { setIndex(i); setFailure(null); setConfirmDuplicate(false); }} className={`flex min-h-11 w-full flex-col gap-0.5 px-4 py-2 text-left ${i === position ? 'bg-brand-soft' : ''}`}>
          <span className="flex justify-between gap-2 font-medium"><span className="truncate">{s.studentName}</span><span className="tabular-nums">{formatLKR(s.amountCents, { exact: true })}</span></span>
          <span className="truncate text-sm text-muted">{s.lines.map((l) => l.className).join(' + ')} · {dateTime(s.submittedAt)}</span>
        </button>
      </li>)}</ol>
    </section>

    <section aria-labelledby="slip-review-title" className="flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="slip-review-title" className="m-0 text-lg font-semibold">{current.studentName} <span className="text-sm font-normal text-muted">{current.studentNo}</span></h2>
        <span className="text-sm text-muted">{t('slipOf', { index: position + 1, count: items.length })}</span>
      </div>
      {notice ? <p role="status" className="m-0 font-medium">{t(notice)}</p> : null}
      {failure ? <FormAlert>{t(`queueErrors.${failure}`)}</FormAlert> : null}

      <SlipViewer key={current.id} slip={current} />

      <dl className="m-0 grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-muted">{t('expected')}</dt><dd className="m-0 text-lg font-semibold tabular-nums">{formatLKR(current.expectedCents, { exact: true })}</dd></div>
        <div><dt className="text-muted">{t('written')}</dt><dd className="m-0 text-lg font-semibold tabular-nums">{formatLKR(current.amountCents, { exact: true })}</dd></div>
        <div className="col-span-2"><dt className="text-muted">{t('months')}</dt><dd className="m-0">{current.lines.map((l) => `${l.className} · ${format.dateTime(new Date(l.month), { month: 'short', year: 'numeric' })} · ${formatLKR(l.openCents, { exact: true })}`).join(', ')}</dd></div>
        <div><dt className="text-muted">{t('slipReference')}</dt><dd className="m-0 break-words font-medium">{current.reference}</dd></div>
        <div><dt className="text-muted">{t('slipDate')}</dt><dd className="m-0">{format.dateTime(new Date(current.slipDate), { day: 'numeric', month: 'short', year: 'numeric' })}</dd></div>
        <div className="col-span-2"><dt className="text-muted">{t('sent')}</dt><dd className="m-0">{dateTime(current.submittedAt)}</dd></div>
      </dl>
      {mismatch ? <p className="m-0 text-sm"><StatusBadge tone="warning">{t('written')}</StatusBadge> {t('mismatch')}</p> : null}
      {current.duplicateOf ? <div className="flex flex-col gap-2">
        <p className="m-0 text-sm"><StatusBadge tone="danger">{t('slipReference')}</StatusBadge> {t('duplicate', { name: current.duplicateOf.studentName, date: format.dateTime(new Date(current.duplicateOf.approvedAt), { day: 'numeric', month: 'short', year: 'numeric' }) })}</p>
        <Checkbox checked={confirmDuplicate} disabled={busy} label={t('confirmDuplicate')} onChange={(e) => setConfirmDuplicate(e.target.checked)} />
      </div> : <p className="m-0 text-sm"><StatusBadge tone="success">{t('slipReference')}</StatusBadge> {t('notDuplicate')}</p>}

      <div className="flex flex-wrap gap-2">
        <Button size="lg" type="button" loading={busy} onClick={() => void approve()}>{t('approve')} <kbd aria-hidden className="ml-1 text-xs opacity-80">A</kbd></Button>
        <Button size="lg" type="button" variant="secondary" disabled={busy} onClick={() => setRejecting(true)}>{t('reject')} <kbd aria-hidden className="ml-1 text-xs opacity-80">R</kbd></Button>
        <Button size="lg" type="button" variant="ghost" disabled={busy || items.length < 2} onClick={skip}>{t('skip')} <kbd aria-hidden className="ml-1 text-xs opacity-80">S</kbd></Button>
      </div>
      <p className="m-0 text-sm text-muted">{t('shortcuts')}</p>
    </section>

    <Dialog open={rejecting} title={t('rejectTitle', { name: current.studentName })} description={t('rejectBody')} onClose={() => setRejecting(false)} busy={busy}>
      <form noValidate onSubmit={(e) => void reject(e)} className="flex flex-col gap-4">
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 font-medium">{t('reason')}</legend>
          {REASONS.map((r, i) => <label key={r} className="flex min-h-11 items-center gap-3">
            <input type="radio" name="slip-reject-reason" value={r} checked={reason === r} autoFocus={i === 0} onChange={() => setReason(r)} />
            {t(`reasons.${r}`)}
          </label>)}
        </fieldset>
        <Field label={t('note')}><Input value={note} maxLength={150} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="flex flex-wrap gap-2">
          <Button size="lg" type="submit" variant="danger" loading={busy}>{t('rejectConfirm')}</Button>
          <Button size="lg" type="button" variant="secondary" disabled={busy} onClick={() => setRejecting(false)}>{t('cancel')}</Button>
        </div>
      </form>
    </Dialog>
  </div>;
}

/**
 * The slip photo with zoom and rotate (view only). Keyed by slip: each slip shown fetches its own
 * short-lived signed URL, kept only in this component's state.
 */
function SlipViewer({ slip }: { slip: Slip }) {
  const t = useTranslations('fees.slips');
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  useEffect(() => {
    let live = true;
    createBrowserApi()
      .api.call('slipImage', { params: { id: slip.id } })
      .then((signed) => { if (live) setUrl(signed.url); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [slip.id]);
  return <div className="flex flex-col gap-2">
    <div className="flex h-80 items-center justify-center overflow-auto rounded-lg border border-line bg-canvas sm:h-[28rem]">
      {/* A private, short-lived signed URL: the Next.js image optimiser must not fetch or cache it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt={t('photoAlt', { name: slip.studentName })} referrerPolicy="no-referrer" className="max-h-full max-w-full transition-transform" style={{ transform: `rotate(${rotation}deg) scale(${zoom})` }} />
        : <p className="m-0 text-muted">{failed ? t('photoUnavailable') : t('photoLoading')}</p>}
    </div>
    <div className="flex gap-2">
      <Button type="button" variant="secondary" aria-label={t('zoomOut')} disabled={zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}><ZoomOut aria-hidden size={18} /></Button>
      <Button type="button" variant="secondary" aria-label={t('zoomIn')} disabled={zoom >= 3} onClick={() => setZoom((z) => Math.min(3, z + 0.25))}><ZoomIn aria-hidden size={18} /></Button>
      <Button type="button" variant="secondary" aria-label={t('rotate')} onClick={() => setRotation((r) => (r + 90) % 360)}><RotateCw aria-hidden size={18} /></Button>
    </div>
  </div>;
}
