'use client';

import { Button, Field, Input, cn, useToast } from '@remix/ui';
import type { Theme } from '@remix/types/api';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { FormAlert } from '@/components/form-alert';
import { brandStyle } from '@/lib/brand';
import { createBrowserApi } from '@/lib/browser-api';
import { actionError, type ActionError } from '@/lib/people';
import { colorState, colorToSave, pickerValue, urlToSave } from '@/lib/theme';

/**
 * Settings → Theme (TEN-03, owner): brand colour with live contrast feedback, logo and tab icon
 * as https addresses (uploads come later). The preview applies the colour through the same
 * validated CSS variables as the real shells, never a raw string. Saving needs a colour that
 * keeps white button text readable — the API enforces the same 4.5 to 1 rule.
 */
export function ThemeForm({ initial }: { initial: Theme }) {
  const t = useTranslations('settings.theme');
  const tErrors = useTranslations('settings.errors');
  const router = useRouter();
  const { toast } = useToast();
  const [color, setColor] = useState(initial.brandColor ?? '');
  const [logo, setLogo] = useState(initial.logoUrl ?? '');
  const [favicon, setFavicon] = useState(initial.faviconUrl ?? '');
  const [failure, setFailure] = useState<ActionError | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  const state = colorState(color);
  const logoUrl = urlToSave(logo);
  const faviconUrl = urlToSave(favicon);
  const colorBlocked = state.state === 'invalid' || state.state === 'low';
  const previewStyle =
    state.state === 'ok' || state.state === 'low' ? brandStyle(state.color) : undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setFailure(null);
    if (colorBlocked || logoUrl === undefined || faviconUrl === undefined) return;
    setBusy(true);
    try {
      await createBrowserApi().api.call('updateTheme', {
        brandColor: colorToSave(color),
        logoUrl,
        faviconUrl,
      });
      toast({ tone: 'success', title: t('saved') });
      router.refresh();
    } catch (err) {
      setFailure(actionError(err));
    } finally {
      setBusy(false);
    }
  }

  const colorFeedback = {
    none: { tone: 'muted', text: t('contrast.none') },
    invalid: { tone: 'danger', text: t('contrast.invalid') },
    low: {
      tone: 'danger',
      text: state.state === 'low' ? t('contrast.low', { ratio: state.ratio }) : '',
    },
    ok: {
      tone: 'success',
      text: state.state === 'ok' ? t('contrast.ok', { ratio: state.ratio }) : '',
    },
  }[state.state];

  return (
    <form
      noValidate
      onSubmit={(e) => void submit(e)}
      className="grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start"
    >
      <div className="bg-surface border-line flex flex-col gap-5 rounded-lg border p-4 lg:p-6">
        <div className="flex flex-col gap-3">
          <Field
            label={t('brandColor')}
            hint={t('brandColorHint')}
            error={submitted && state.state === 'invalid' ? t('errors.colorInvalid') : undefined}
          >
            <Input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              maxLength={7}
              placeholder={t('colorPlaceholder')}
              aria-label={t('colorText')}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input
                type="color"
                value={pickerValue(color)}
                onChange={(e) => setColor(e.target.value)}
                className="border-line-strong h-11 w-14 cursor-pointer rounded-md border bg-transparent p-1"
              />
              {t('colorPicker')}
            </label>
            {color !== '' ? (
              <Button variant="ghost" onClick={() => setColor('')}>
                {t('useDefault')}
              </Button>
            ) : null}
          </div>
          <p
            role="status"
            aria-label={t('contrast.label')}
            className={cn(
              'm-0 flex items-start gap-2 text-sm',
              colorFeedback.tone === 'success' && 'text-success-ink',
              colorFeedback.tone === 'danger' && 'text-danger-ink',
              colorFeedback.tone === 'muted' && 'text-muted',
            )}
          >
            {colorFeedback.tone === 'success' ? (
              <CircleCheck aria-hidden size={16} className="mt-0.5 flex-none" />
            ) : colorFeedback.tone === 'danger' ? (
              <CircleAlert aria-hidden size={16} className="mt-0.5 flex-none" />
            ) : null}
            <span>{colorFeedback.text}</span>
          </p>
        </div>

        <Field
          label={t('logoUrl')}
          hint={t('logoUrlHint')}
          error={logoUrl === undefined ? t('urlInvalid') : undefined}
        >
          <Input
            type="url"
            inputMode="url"
            value={logo}
            onChange={(e) => setLogo(e.target.value)}
            autoComplete="off"
            maxLength={2048}
            placeholder="https://"
          />
        </Field>
        <Field
          label={t('faviconUrl')}
          hint={t('faviconUrlHint')}
          error={faviconUrl === undefined ? t('urlInvalid') : undefined}
        >
          <Input
            type="url"
            inputMode="url"
            value={favicon}
            onChange={(e) => setFavicon(e.target.value)}
            autoComplete="off"
            maxLength={2048}
            placeholder="https://"
          />
        </Field>

        {failure ? <FormAlert>{tErrors(failure)}</FormAlert> : null}
        <div className="flex justify-end">
          <Button
            type="submit"
            loading={busy}
            disabled={colorBlocked || logoUrl === undefined || faviconUrl === undefined}
          >
            {busy ? t('saving') : t('save')}
          </Button>
        </div>
      </div>

      <aside
        aria-label={t('preview.title')}
        style={previewStyle}
        className="bg-surface border-line flex flex-col gap-4 rounded-lg border p-4"
      >
        <h2 className="m-0 text-base font-semibold leading-6">{t('preview.title')}</h2>
        {typeof logoUrl === 'string' ? (
          // The institute's own picture, unknown size and host: next/image would need each one configured.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt={t('preview.logoAlt')}
            className="border-line size-14 rounded-lg border object-contain"
          />
        ) : null}
        <span
          aria-hidden
          className="bg-brand inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-semibold text-white"
        >
          {t('preview.sampleButton')}
        </span>
        <span aria-hidden className="text-brand text-sm font-medium underline">
          {t('preview.sampleLink')}
        </span>
        <span aria-hidden className="bg-brand-soft border-brand-line h-3 rounded-full border" />
      </aside>
    </form>
  );
}
