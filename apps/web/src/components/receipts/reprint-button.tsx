'use client';
import { Button } from '@remix/ui';
import { Printer } from 'lucide-react';
import { useTranslations } from 'next-intl';
export function ReprintButton() {
  const t = useTranslations('settings.receiptPrint');
  return (
    <Button type="button" onClick={() => window.print()}>
      <Printer aria-hidden="true" size={18} />
      {t('reprint')}
    </Button>
  );
}
