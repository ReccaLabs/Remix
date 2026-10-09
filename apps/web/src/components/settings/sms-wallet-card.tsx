'use client';
import { Button, DataTable, EmptyState, Field, Input, StatusBadge, useToast } from '@remix/ui';
import { ApiError, smsTopUpRequestSchema, type SmsWallet } from '@remix/types/api';
import { formatLKR } from '@remix/types/money';
import { MessageSquareText, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { FormAlert } from '@/components/form-alert';
import { createBrowserApi } from '@/lib/browser-api';
import { cashCents } from '@/lib/fees-money';
import { actionError, type ActionError } from '@/lib/people';

/** MSG-02 SMS wallet: balance, sender name, recent ledger and the "Buy SMS" request. */
export function SmsWalletCard({ initial }: { initial: SmsWallet }) {
  const t = useTranslations('settings.sms');
  const errors = useTranslations('settings.errors');
  const format = useFormatter();
  const router = useRouter();
  const { toast } = useToast();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionError | 'tooMany' | null>(null);

  async function buy(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const cents = cashCents(amount);
    const parsed = cents === null ? null : smsTopUpRequestSchema.safeParse({ amountCents: cents });
    if (!parsed?.success) {
      setFailure('validation');
      return;
    }
    setBusy(true);
    try {
      await createBrowserApi().api.call('requestSmsTopUp', parsed.data);
      toast({ tone: 'success', title: t('bought') });
      setAmount('');
      router.refresh();
    } catch (err) {
      setFailure(err instanceof ApiError && err.problem.code === 'CONFLICT' ? 'tooMany' : actionError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 lg:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="sms-balance" className="m-0 flex items-center gap-2 text-lg font-semibold text-ink">
              <MessageSquareText aria-hidden size={20} />{t('balance')}
            </h2>
            <p className="m-0 mt-1 text-3xl font-semibold tabular-nums text-ink">{formatLKR(initial.balanceCents, { exact: true })}</p>
          </div>
          <StatusBadge tone={initial.lowBalance ? 'warning' : 'success'}>{initial.lowBalance ? t('lowBalanceBadge') : t('healthy')}</StatusBadge>
        </div>
        {initial.lowBalance ? (
          <p role="status" className="m-0 flex items-start gap-2 text-warning-ink">
            <TriangleAlert aria-hidden size={16} className="mt-1 shrink-0" />{t('lowBalance')}
          </p>
        ) : null}
        <dl className="m-0 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">{t('sender')}</dt>
          <dd className="m-0">{initial.senderId ?? t('senderDefault')}<span className="block text-xs text-muted">{t('senderHint')}</span></dd>
          <dt className="text-muted">{t('price')}</dt>
          <dd className="m-0 tabular-nums">{formatLKR(initial.segmentPriceCents, { exact: true })}</dd>
          <dt className="text-muted">{t('threshold')}</dt>
          <dd className="m-0 tabular-nums">{formatLKR(initial.lowBalanceThresholdCents, { exact: true })}</dd>
        </dl>
      </section>

      <form noValidate onSubmit={(event) => void buy(event)} className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 lg:p-6">
        <h2 id="sms-buy" className="m-0 text-lg font-semibold text-ink">{t('buyTitle')}</h2>
        <p className="m-0 text-sm text-muted">{t('buyHint')}</p>
        {initial.openTopUpRequests > 0 ? <p className="m-0 text-sm font-medium">{t('openRequests', { count: initial.openTopUpRequests })}</p> : null}
        <Field label={t('buyAmount')} hint={t('buyMin')}>
          <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="2000" />
        </Field>
        {failure ? <FormAlert>{failure === 'tooMany' ? t('tooMany') : errors(failure)}</FormAlert> : null}
        <div className="flex justify-end">
          <Button size="lg" type="submit" loading={busy} disabled={busy}>{t('buyButton')}</Button>
        </div>
      </form>

      <section className="flex flex-col gap-3">
        <h2 id="sms-recent" className="m-0 text-lg font-semibold text-ink">{t('recent')}</h2>
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <DataTable
            caption={t('recent')}
            rows={initial.recent}
            rowKey={(entry) => entry.id}
            columns={[
              { id: 'date', header: t('date'), cell: (e) => format.dateTime(new Date(e.at), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Colombo' }) },
              { id: 'kind', header: t('kind'), rowHeader: true, cell: (e) => t(`kinds.${e.kind}`) },
              { id: 'amount', header: t('amount'), align: 'end', cell: (e) => `${e.amountCents > 0 ? '+' : e.amountCents < 0 ? '−' : ''}${formatLKR(Math.abs(e.amountCents), { exact: true })}` },
              { id: 'after', header: t('balanceAfter'), align: 'end', cell: (e) => formatLKR(e.balanceAfterCents, { exact: true }) },
              { id: 'note', header: t('note'), wrap: true, cell: (e) => e.note ?? '' },
            ]}
            empty={<EmptyState size="compact" title={t('none')} />}
          />
        </div>
      </section>
    </div>
  );
}
