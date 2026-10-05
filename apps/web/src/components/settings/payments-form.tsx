'use client';
import { Button, Checkbox, Field, Input, useToast } from '@remix/ui';
import { updatePayhereSettingsSchema, type PayhereSettings } from '@remix/types/api';
import { CreditCard } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { FormAlert } from '@/components/form-alert';
import { Select } from '@/components/people/select';
import { createBrowserApi } from '@/lib/browser-api';
import { submitPayhereForm } from '@/lib/payhere-form';
import { actionError, type ActionError } from '@/lib/people';

export function PaymentsForm({ initial }: { initial: PayhereSettings }) {
  const t = useTranslations('settings.payments');
  const errors = useTranslations('settings.errors');
  const format = useFormatter();
  const router = useRouter();
  const { toast } = useToast();
  const [settings, setSettings] = useState(initial);
  const [merchantId, setMerchantId] = useState(initial.merchantId ?? '');
  const [secret, setSecret] = useState('');
  const [mode, setMode] = useState(initial.mode);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [failure, setFailure] = useState<ActionError | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const parsed = updatePayhereSettingsSchema.safeParse({
      mode,
      enabled,
      ...(merchantId.trim() ? { merchantId: merchantId.trim() } : {}),
      ...(secret ? { merchantSecret: secret } : {}),
    });
    if (!parsed.success) {
      setFailure('validation');
      return;
    }
    setBusy('save');
    try {
      const result = await createBrowserApi().api.call('updatePayhereSettings', parsed.data);
      setSettings(result);
      setSecret('');
      toast({ tone: 'success', title: t('saved') });
      router.refresh();
    } catch (err) {
      setFailure(actionError(err));
    } finally {
      setBusy(null);
    }
  }
  async function test() {
    setBusy('test');
    setFailure(null);
    try {
      submitPayhereForm(await createBrowserApi().api.call('testPayhere'));
    } catch (err) {
      setFailure(actionError(err));
    } finally {
      setBusy(null);
    }
  }
  return (
    <form
      noValidate
      onSubmit={(event) => void save(event)}
      className="flex max-w-2xl flex-col gap-4 rounded-lg border border-line bg-surface p-4 lg:p-6"
    >
      <h2 className="m-0 flex items-center gap-2 text-lg font-semibold text-ink">
        <CreditCard aria-hidden="true" size={20} />
        {t('title')}
      </h2>
      <Field label={t('merchantId')} hint={t('merchantIdHint')}>
        <Input
          inputMode="numeric"
          maxLength={20}
          value={merchantId}
          onChange={(event) => setMerchantId(event.target.value)}
        />
      </Field>
      <Field
        label={t('secret')}
        hint={
          settings.secretHint ? t('secretStored', { hint: settings.secretHint }) : t('secretHint')
        }
      >
        <Input
          type="password"
          autoComplete="new-password"
          maxLength={200}
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
        />
      </Field>
      <Field label={t('mode')}>
        <Select
          value={mode}
          onChange={(event) => setMode(event.target.value as PayhereSettings['mode'])}
        >
          <option value="sandbox">{t('sandbox')}</option>
          <option value="live">{t('live')}</option>
        </Select>
      </Field>
      <Checkbox
        label={t('enabled')}
        checked={enabled}
        onChange={(event) => setEnabled(event.target.checked)}
      />
      <p className="m-0 text-sm text-muted">
        {settings.lastTest
          ? t('lastTest', {
              at: format.dateTime(new Date(settings.lastTest.at), {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Asia/Colombo',
              }),
              status: t(`statuses.${settings.lastTest.status}`),
            })
          : t('noTest')}
      </p>
      <p className="m-0 text-sm text-muted">{t('testHint')}</p>
      {failure ? <FormAlert>{errors(failure)}</FormAlert> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button
          size="lg"
          type="button"
          variant="secondary"
          disabled={busy !== null}
          loading={busy === 'test'}
          onClick={() => void test()}
        >
          {t('test')}
        </Button>
        <Button size="lg" type="submit" disabled={busy !== null} loading={busy === 'save'}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}
