'use client';
import { Button } from '@remix/ui';
import { ApiError } from '@remix/types/api';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { createBrowserApi } from '@/lib/browser-api';

export function ReceiptDownload({ id }: { id: string }) {
  const t = useTranslations('fees');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  async function download() {
    setBusy(true); setError(false); setPending(false); setUrl(null);
    try {
      const signed = await createBrowserApi().api.call('receiptPdf', { params: { id } });
      setUrl(signed.url);
      // A same-tab navigation works on mobile even after the async request loses popup activation.
      window.location.assign(signed.url);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setPending(true);
      else setError(true);
    } finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-1">
    <Button size="lg" type="button" variant="ghost" loading={busy} onClick={() => void download()}><Download aria-hidden size={18} />{t('receipt')}</Button>
    {url ? <a href={url} className="text-brand inline-flex min-h-11 items-center underline">{t('receipt')}</a> : null}
    {error || pending ? <p role="alert" className="m-0 text-sm text-danger-ink">{pending ? t('receiptPending') : t('errors.network')}</p> : null}
  </div>;
}
