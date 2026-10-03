'use client';

import { cn } from '@remix/ui';
import { LOCALES, type AppLocale } from '@remix/types/api';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { FormAlert } from '@/components/form-alert';
import { createBrowserApi } from '@/lib/browser-api';

/**
 * AUTH-04 language preference (Student Me 16a/b), saved to the account at once. The portal
 * itself switches language only when a locale goes live after native review (ADR 0002); until
 * then the choice is remembered for later.
 */
export function LanguagePicker({ initial }: { initial: AppLocale }) {
  const t = useTranslations('portal');
  const hintId = useId();
  const [value, setValue] = useState<AppLocale>(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  async function choose(locale: AppLocale) {
    const previous = value;
    setValue(locale);
    setState('saving');
    try {
      await createBrowserApi().api.call('updateMe', { locale });
      setState('saved');
    } catch {
      setValue(previous);
      setState('failed');
    }
  }

  return (
    <fieldset className="m-0 flex flex-col gap-3 border-0 p-0" aria-describedby={hintId}>
      <legend className="sr-only">{t('me.languageTitle')}</legend>
      <div className="bg-paper-2 flex rounded-md p-1">
        {LOCALES.map((locale) => (
          <label
            key={locale}
            className={cn(
              'flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-[6px] px-3 text-sm font-medium',
              'has-[:focus-visible]:outline-brand has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
              value === locale ? 'bg-surface text-ink shadow-sm' : 'text-ink-2',
            )}
          >
            <input
              type="radio"
              name="locale"
              value={locale}
              checked={value === locale}
              disabled={state === 'saving'}
              onChange={() => void choose(locale)}
              className="sr-only"
            />
            <span lang={locale}>{t(`languages.${locale}`)}</span>
          </label>
        ))}
      </div>
      <p id={hintId} className="text-muted m-0 text-[13px]">
        {t('me.languageHint')}
      </p>
      {state === 'saved' ? (
        <p role="status" className="text-success-ink m-0 text-sm font-medium">
          {t('me.languageSaved')}
        </p>
      ) : null}
      {state === 'failed' ? <FormAlert>{t('me.languageFailed')}</FormAlert> : null}
    </fieldset>
  );
}
