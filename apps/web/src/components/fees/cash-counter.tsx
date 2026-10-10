'use client';
import { Button, Field, Input, StatusBadge, buttonClass } from '@remix/ui';
import {
  ApiError,
  cardLookupSchema,
  type CardLookupResponse,
  type CashPaymentRequest,
  type StudentFees,
  type StudentListItem,
} from '@remix/types/api';
import { formatLKR, type Cents } from '@remix/types/money';
import { Banknote, Printer, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { createBrowserApi } from '@/lib/browser-api';
import { cashCents } from '@/lib/fees-money';
import { FeeError, feeFailure, type FeeFailure } from './fee-error';
import { OpenMonths } from './open-months';
import { StudentSearch, type StudentSearchHandle } from './student-search';
import { CounterScanner } from './counter-scanner';

export function CashCounter() {
  const t = useTranslations('fees');
  const [student, setStudent] = useState<StudentFees | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [received, setReceived] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<FeeFailure | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [changeGiven, setChangeGiven] = useState<Cents>(0);
  const [scanNotice, setScanNotice] = useState<'ordered' | 'revoked' | 'archived' | null>(null);
  const [scanBadge, setScanBadge] = useState<'card' | 'temporary' | null>(null);
  const search = useRef<StudentSearchHandle>(null);
  const version = useRef(0);
  const inFlight = useRef(false);
  const retry = useRef<{ signature: string; body: CashPaymentRequest } | null>(null);
  const months = useRef<HTMLDivElement>(null);
  const total: Cents =
    student?.openLines
      .filter((l) => selected.includes(l.id))
      .reduce((sum, l) => sum + l.openCents, 0) ?? 0;
  const cash = cashCents(received);
  function reset() {
    if (inFlight.current) return;
    version.current++;
    setStudent(null);
    setSelected([]);
    setReceived('');
    setFailure(null);
    setLoading(false);
    setScanNotice(null);
    setScanBadge(null);
    retry.current = null;
    setEpoch((n) => n + 1);
  }
  async function choose(chosen: Pick<StudentListItem, 'id'>, scan?: CardLookupResponse) {
    const current = ++version.current;
    setFailure(null);
    setLoading(true);
    setStudent(null);
    setSelected([]);
    setReceived('');
    retry.current = null;
    setScanBadge(scan?.card ? (scan.card.kind === 'temporary' ? 'temporary' : 'card') : null);
    setScanNotice(scan?.student.archived ? 'archived' : null);
    try {
      const fees = await createBrowserApi().api.call('studentFees', { params: { id: chosen.id } });
      if (current !== version.current) return;
      setStudent(fees);
      requestAnimationFrame(() => {
        months.current?.querySelector('input')?.focus();
      });
    } catch (err) {
      if (current === version.current) setFailure(feeFailure(err));
    } finally {
      if (current === version.current) setLoading(false);
    }
  }
  async function lookup(value: string, isCurrent = () => true): Promise<boolean> {
    if (inFlight.current) return true;
    const parsed = cardLookupSchema.safeParse({ input: value });
    if (!parsed.success) return false;
    const current = ++version.current;
    setFailure(null);
    setLoading(true);
    setStudent(null);
    setSelected([]);
    setReceived('');
    setScanBadge(null);
    setScanNotice(null);
    retry.current = null;
    try {
      const found = await createBrowserApi().api.call('lookupCard', parsed.data);
      if (current !== version.current || !isCurrent()) return true;
      if (found.card?.status === 'ordered' || found.card?.status === 'revoked') {
        setScanNotice(found.card.status);
        return true;
      }
      await choose({ id: found.student.id }, found);
      return true;
    } catch (err) {
      if (current !== version.current || !isCurrent()) return true;
      if (err instanceof ApiError && err.status === 404) return false;
      setFailure(feeFailure(err));
      return true;
    } finally {
      if (current === version.current) setLoading(false);
    }
  }
  async function scan(value: string) {
    if (!(await lookup(value))) await search.current?.search(value);
  }
  async function collect(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!student || selected.length === 0 || selected.length > 24 || cash === null) {
      setFailure('validation');
      return;
    }
    if (cash < total) {
      setFailure('cash');
      return;
    }
    const signature = JSON.stringify([student.studentId, selected, cash]);
    const body =
      retry.current?.signature === signature
        ? retry.current.body
        : {
            studentId: student.studentId,
            lineIds: selected,
            cashReceivedCents: cash,
            idempotencyKey: crypto.randomUUID(),
          };
    retry.current = { signature, body };
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    // Reserve the print tab while the Enter/click gesture is active, before awaiting the API.
    const print = window.open('about:blank', '_blank');
    if (print) print.opener = null;
    try {
      const payment = await createBrowserApi().api.call('recordCashPayment', body);
      if (payment.receiptId) {
        const href = `/admin/receipts/${payment.receiptId}/print`;
        setReceipt(href);
        setChangeGiven(cash !== null && cash > total ? cash - total : 0);
        if (print) print.location.href = href;
      } else print?.close();
      inFlight.current = false;
      reset();
    } catch (err) {
      print?.close();
      setFailure(feeFailure(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          reset();
        }
      }}
      className="flex flex-col gap-5"
    >
      {receipt ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-success-soft px-4 py-3 text-success-ink"
        >
          <span>{changeGiven > 0 ? t('successChange', { change: formatLKR(changeGiven, { exact: true }) }) : t('success')}</span>
          <a
            href={receipt}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass({ variant: 'secondary', size: 'lg' })}
          >
            <Printer aria-hidden size={18} />
            {t('printReceipt')}
          </a>
        </div>
      ) : null}
      <CounterScanner onScan={(value) => void scan(value)} disabled={busy || loading} />
      <StudentSearch
        ref={search}
        key={epoch}
        focus
        disabled={busy}
        onScan={lookup}
        onChoose={(s) => void choose(s)}
      />
      {scanNotice ? (
        <p
          role="alert"
          className={`m-0 rounded-lg p-4 ${scanNotice === 'revoked' ? 'bg-danger-soft text-danger-ink' : 'bg-warning-soft text-warning-ink'}`}
        >
          {t(`scan.${scanNotice}`)}
        </p>
      ) : null}
      <FeeError failure={failure} />
      {loading ? <p role="status">{t('loading')}</p> : null}
      {student ? (
        <form
          onSubmit={(e) => void collect(e)}
          className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]"
        >
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-line bg-surface px-4 py-4">
              <p className="m-0 font-semibold">{student.displayName}</p>
              <p className="m-0 text-sm text-muted">{student.studentNo}</p>
              {scanBadge ? (
                <StatusBadge tone="success">{t(`scan.${scanBadge}`)}</StatusBadge>
              ) : null}
            </div>
            <div ref={months}>
              <OpenMonths
                lines={student.openLines}
                selected={selected}
                onSelect={setSelected}
                disabled={busy}
              />
            </div>
          </div>
          <div className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-5">
            <div className="flex items-center justify-between gap-3">
              <span>{t('total')}</span>
              <output className="text-xl font-semibold tabular-nums">
                {formatLKR(total, { exact: true })}
              </output>
            </div>
            <Field label={t('cashReceived')}>
              <Input
                inputMode="decimal"
                value={received}
                disabled={busy}
                onChange={(e) => setReceived(e.target.value)}
              />
            </Field>
            <div
              aria-live="polite"
              className="flex items-center justify-between gap-3 rounded-md bg-success-soft p-3 text-success-ink"
            >
              <span>{t('change')}</span>
              <output className="font-semibold tabular-nums">
                {formatLKR(cash !== null && cash >= total ? cash - total : 0, { exact: true })}
              </output>
            </div>
            <Button size="lg" type="submit" loading={busy} disabled={selected.length === 0}>
              <Banknote aria-hidden size={18} />
              {t('collect')}
            </Button>
            <Button size="lg" type="button" variant="secondary" disabled={busy} onClick={reset}>
              <RotateCcw aria-hidden size={18} />
              {t('reset')}
            </Button>
            <p className="m-0 text-sm text-muted">{t('keyboard')}</p>
          </div>
        </form>
      ) : null}
    </div>
  );
}
