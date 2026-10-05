'use client';
import { Button, Checkbox, Field, Input, useToast } from '@remix/ui';
import { updateFeeSettingsSchema, type FeeSettings } from '@remix/types/api';
import { Landmark, ReceiptText } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { FormAlert } from '@/components/form-alert';
import { createBrowserApi } from '@/lib/browser-api';
import { actionError, type ActionError } from '@/lib/people';

const BANK_KEYS = ['bankName', 'branch', 'accountNumber', 'accountName'] as const;
const BANK_LENGTH = { bankName: 80, branch: 80, accountNumber: 24, accountName: 120 };
export function FeeSettingsForm({ initial }: { initial: FeeSettings }) {
  const t = useTranslations('settings.fees');
  const errors = useTranslations('settings.errors');
  const router = useRouter();
  const { toast } = useToast();
  const [dueDay, setDueDay] = useState(String(initial.dueDay));
  const [before, setBefore] = useState(String(initial.remindBeforeDays));
  const [after, setAfter] = useState(String(initial.remindAfterDays));
  const [reminders, setReminders] = useState(initial.remindersEnabled);
  const [bankEnabled, setBankEnabled] = useState(initial.bankDetails !== null);
  const [bank, setBank] = useState(
    initial.bankDetails ?? { bankName: '', branch: '', accountNumber: '', accountName: '' },
  );
  const [receipt, setReceipt] = useState({
    address: initial.receipt.address ?? '',
    phone: initial.receipt.phone ?? '',
    footer: initial.receipt.footer ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionError | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const parsed = updateFeeSettingsSchema.safeParse({
      dueDay: Number(dueDay),
      remindersEnabled: reminders,
      remindBeforeDays: Number(before),
      remindAfterDays: Number(after),
      bankDetails: bankEnabled ? bank : null,
      receipt: {
        address: receipt.address.trim() || null,
        phone: receipt.phone.trim() || null,
        footer: receipt.footer.trim() || null,
      },
    });
    if (!parsed.success) {
      setFailure('validation');
      return;
    }
    setBusy(true);
    try {
      await createBrowserApi().api.call('updateFeeSettings', parsed.data);
      toast({ tone: 'success', title: t('saved') });
      router.refresh();
    } catch (err) {
      setFailure(actionError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      noValidate
      onSubmit={(event) => void save(event)}
      className="flex max-w-2xl flex-col gap-6 rounded-lg border border-line bg-surface p-4 lg:p-6"
    >
      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <legend className="mb-4 text-lg font-semibold text-ink">{t('schedule')}</legend>
        <Field label={t('dueDay')} hint={t('dueDayHint')}>
          <Input
            type="number"
            min={1}
            max={28}
            step={1}
            value={dueDay}
            onChange={(event) => setDueDay(event.target.value)}
          />
        </Field>
        <Checkbox
          label={t('remindersEnabled')}
          checked={reminders}
          onChange={(event) => setReminders(event.target.checked)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('beforeDays')} hint={t('beforeHint')}>
            <Input
              type="number"
              min={0}
              max={10}
              step={1}
              value={before}
              onChange={(event) => setBefore(event.target.value)}
            />
          </Field>
          <Field label={t('afterDays')} hint={t('afterHint')}>
            <Input
              type="number"
              min={1}
              max={30}
              step={1}
              value={after}
              onChange={(event) => setAfter(event.target.value)}
            />
          </Field>
        </div>
      </fieldset>
      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <legend className="mb-4 text-lg font-semibold text-ink">
          <Landmark aria-hidden="true" className="mr-2 inline" size={20} />
          {t('bankTitle')}
        </legend>
        <Checkbox
          label={t('bankEnabled')}
          checked={bankEnabled}
          onChange={(event) => setBankEnabled(event.target.checked)}
        />
        {bankEnabled ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {BANK_KEYS.map((key) => (
              <Field key={key} label={t(`bank.${key}`)}>
                <Input
                  value={bank[key]}
                  maxLength={BANK_LENGTH[key]}
                  onChange={(event) => setBank({ ...bank, [key]: event.target.value })}
                />
              </Field>
            ))}
          </div>
        ) : null}
      </fieldset>
      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <legend className="mb-4 text-lg font-semibold text-ink">
          <ReceiptText aria-hidden="true" className="mr-2 inline" size={20} />
          {t('receiptTitle')}
        </legend>
        <Field label={t('receipt.address')}>
          <Input
            value={receipt.address}
            maxLength={200}
            onChange={(event) => setReceipt({ ...receipt, address: event.target.value })}
          />
        </Field>
        <Field label={t('receipt.phone')}>
          <Input
            type="tel"
            value={receipt.phone}
            maxLength={40}
            onChange={(event) => setReceipt({ ...receipt, phone: event.target.value })}
          />
        </Field>
        <Field label={t('receipt.footer')}>
          <textarea
            className="min-h-22 w-full rounded-md border border-line-strong bg-surface p-3 text-base text-ink"
            maxLength={200}
            value={receipt.footer}
            onChange={(event) => setReceipt({ ...receipt, footer: event.target.value })}
          />
        </Field>
      </fieldset>
      {failure ? <FormAlert>{errors(failure)}</FormAlert> : null}
      <div className="flex justify-end">
        <Button type="submit" loading={busy}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}
