'use client';

import { Button, Field, Input, useToast } from '@remix/ui';
import { LOCALES, updateGeneralSettingsSchema } from '@remix/types/api';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { FormAlert } from '@/components/form-alert';
import { Select } from '@/components/people/select';
import { createBrowserApi } from '@/lib/browser-api';
import { actionError, type ActionError } from '@/lib/people';

/** Settings → General (owner): institute name and default language. */
export function GeneralForm({
  initial,
}: {
  initial: { name: string; defaultLocale: (typeof LOCALES)[number] };
}) {
  const t = useTranslations('settings.general');
  const tErrors = useTranslations('settings.errors');
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState(initial.name);
  const [locale, setLocale] = useState(initial.defaultLocale);
  const [nameError, setNameError] = useState(false);
  const [failure, setFailure] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const body = { name: name.trim(), defaultLocale: locale };
    const parsed = updateGeneralSettingsSchema.safeParse(body);
    setNameError(!parsed.success);
    if (!parsed.success) return;
    setBusy(true);
    try {
      await createBrowserApi().api.call('updateGeneralSettings', parsed.data);
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
      onSubmit={(e) => void submit(e)}
      className="bg-surface border-line flex max-w-2xl flex-col gap-4 rounded-lg border p-4 lg:p-6"
    >
      <Field
        label={t('name')}
        hint={t('nameHint')}
        error={nameError ? t('errors.nameInvalid') : undefined}
      >
        <Input
          value={name}
          maxLength={120}
          autoComplete="organization"
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label={t('language')} hint={t('languageHint')}>
        <Select
          value={locale}
          onChange={(e) => setLocale(e.target.value as (typeof LOCALES)[number])}
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {t(`languages.${l}`)}
            </option>
          ))}
        </Select>
      </Field>
      {failure ? <FormAlert>{tErrors(failure)}</FormAlert> : null}
      <div className="flex justify-end">
        <Button type="submit" loading={busy}>
          {busy ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  );
}
