import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { getRequestContext } from '@/server/request';

/** The platform admin host (admin.remix.lk) — Recca Labs staff only. */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common.meta');
  return {
    title: { default: t('platformTitle'), template: t('platformTitleTemplate') },
    robots: { index: false, follow: false },
  };
}

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  // Fail closed if this tree is ever reached without the proxy having classified the host.
  const ctx = await getRequestContext();
  if (ctx.area !== 'platform') notFound();
  return children;
}
