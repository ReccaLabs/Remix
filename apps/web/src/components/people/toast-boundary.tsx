'use client';

import { ToastProvider } from '@remix/ui';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

/** The UI kit's toast provider with localised labels. */
export function ToastBoundary({ children }: { children: ReactNode }) {
  const t = useTranslations('common.toast');
  return (
    <ToastProvider dismissLabel={t('dismiss')} regionLabel={t('region')}>
      {children}
    </ToastProvider>
  );
}
