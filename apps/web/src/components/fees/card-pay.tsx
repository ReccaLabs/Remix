'use client';
import { Button } from '@remix/ui';
import { ApiError, type InvoiceLine } from '@remix/types/api';
import { formatLKR } from '@remix/types/money';
import { CreditCard } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { FormAlert } from '@/components/form-alert';
import { createBrowserApi } from '@/lib/browser-api';
import { submitPayhereForm } from '@/lib/payhere-form';
import { OpenMonths } from './open-months';

type CardFailure = 'validation' | 'paid' | 'unavailable' | 'rateLimited' | 'network';

function cardFailure(error: unknown): CardFailure {
  if (!(error instanceof ApiError)) return 'network';
  switch (error.problem.code) {
    case 'VALIDATION_FAILED':
      return 'validation';
    case 'ALREADY_PAID':
      return 'paid';
    case 'PAYMENT_PROVIDER_UNAVAILABLE':
      return 'unavailable';
    case 'RATE_LIMITED':
      return 'rateLimited';
    default:
      return 'network';
  }
}

/**
 * FEE-03/04: choose whole open months, then the API signs a PayHere order for their open total
 * and the browser posts it to PayHere (CSP form-action allows only the two gateway URLs on this
 * page). Nothing is paid until PayHere's verified notification reaches the API; the return page
 * polls the order status.
 */
export function CardPay({ lines }: { lines: InvoiceLine[] }) {
  const t = useTranslations('fees.card');
  const [selected, setSelected] = useState<string[]>(lines.map((l) => l.id));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<CardFailure | null>(null);
  const inFlight = useRef(false);
  const total = lines
    .filter((l) => selected.includes(l.id))
    .reduce((sum, l) => sum + l.openCents, 0);

  async function pay(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    if (selected.length === 0 || total <= 0) {
      setFailure('validation');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const checkout = await createBrowserApi().api.call('createCheckout', { lineIds: selected });
      // Leaves the page; keep the button busy so a second order is not started meanwhile.
      submitPayhereForm(checkout);
    } catch (err) {
      setFailure(cardFailure(err));
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (lines.length === 0) return null;
  return (
    <section
      aria-labelledby="card-pay-title"
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
    >
      <h2 id="card-pay-title" className="m-0 flex items-center gap-2 text-base font-semibold">
        <CreditCard aria-hidden size={18} />
        {t('title')}
      </h2>
      <form noValidate onSubmit={(e) => void pay(e)} className="flex flex-col gap-4">
        <p className="m-0 text-sm text-muted">{t('hint')}</p>
        {failure ? <FormAlert>{t(`errors.${failure}`)}</FormAlert> : null}
        <OpenMonths
          title={t('months')}
          lines={lines}
          selected={selected}
          disabled={busy}
          onSelect={setSelected}
        />
        <Button size="lg" type="submit" loading={busy} disabled={selected.length === 0}>
          {busy ? t('redirecting') : t('pay', { amount: formatLKR(total, { exact: true }) })}
        </Button>
      </form>
    </section>
  );
}
