'use client';
import { Button, buttonClass, StatusBadge, type StatusTone } from '@remix/ui';
import { ApiError, type CHECKOUT_STATUSES } from '@remix/types/api';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createBrowserApi } from '@/lib/browser-api';
import { PORTAL_PATHS } from '@/lib/paths';
import { ReceiptDownload } from './receipt-download';

type Status = (typeof CHECKOUT_STATUSES)[number];

const TONES: Record<Status, StatusTone> = {
  pending: 'warning',
  paid: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  expired: 'neutral',
};

/** Poll every 2 s for up to 2 minutes, then stop and offer "Check again". */
export const POLL_INTERVAL_MS = 2000;
export const POLL_ATTEMPTS = 60;

/**
 * FEE-04 return and cancel pages. The PayHere redirect proves nothing (ADR 0008 §6): this only
 * shows what the API learned from PayHere's verified notification. Status = word + colour.
 */
export function CheckoutResult({ checkoutId }: { checkoutId: string | null }) {
  const t = useTranslations('fees.checkout');
  const [status, setStatus] = useState<Status>('pending');
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [missing, setMissing] = useState(checkoutId === null);
  const [gaveUp, setGaveUp] = useState(false);
  const [round, setRound] = useState(0);
  const attempts = useRef(0);

  const check = useCallback(async (): Promise<Status | null> => {
    if (!checkoutId) return null;
    try {
      const res = await createBrowserApi().api.call('checkoutStatus', {
        params: { id: checkoutId },
      });
      setStatus(res.status);
      setReceiptId(res.receiptId);
      return res.status;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
        setMissing(true);
        return null;
      }
      return 'pending';
    }
  }, [checkoutId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    attempts.current = 0;
    const tick = async () => {
      const next = await check();
      if (cancelled || next !== 'pending') return;
      attempts.current += 1;
      if (attempts.current >= POLL_ATTEMPTS) setGaveUp(true);
      else timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [check, round]);

  const back = (
    <a href={PORTAL_PATHS.pay} className={buttonClass({ variant: 'secondary', size: 'lg' })}>
      {t('backToPay')}
    </a>
  );

  if (missing) {
    return (
      <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
        <p role="alert" className="m-0">
          {t('notFound')}
        </p>
        <div>{back}</div>
      </section>
    );
  }

  const hint =
    status === 'pending' ? (gaveUp ? t('stillChecking') : t('checkingHint')) : t(`${status}Hint`);
  return (
    <section
      aria-labelledby="checkout-result-title"
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
    >
      <h2 id="checkout-result-title" className="m-0 text-base font-semibold">
        {t('title')}
      </h2>
      <div role="status" aria-live="polite" className="flex flex-col gap-3">
        <div>
          <StatusBadge tone={TONES[status]}>{t(`status.${status}`)}</StatusBadge>
        </div>
        {status === 'pending' && !gaveUp ? (
          <p className="m-0 font-semibold">{t('checking')}</p>
        ) : null}
        <p className="m-0 text-muted">{hint}</p>
      </div>
      {status === 'paid' && receiptId ? <ReceiptDownload id={receiptId} /> : null}
      <div className="flex flex-wrap gap-3">
        {status === 'pending' && gaveUp ? (
          <Button
            size="lg"
            type="button"
            onClick={() => {
              setGaveUp(false);
              setRound((n) => n + 1);
            }}
          >
            {t('checkAgain')}
          </Button>
        ) : null}
        {back}
      </div>
    </section>
  );
}
