'use client';
import { Button, buttonClass } from '@remix/ui';
import { Printer } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import styles from './card-print.module.css';
export function CardPrintControls({
  backHref,
  sheet = false,
}: {
  backHref: string;
  sheet?: boolean;
}) {
  const t = useTranslations('students.cards');
  return (
    <div className={styles.controls}>
      <h1 className="m-0 text-xl font-semibold">{t(sheet ? 'printSheet' : 'printTitle')}</h1>
      <Button size="lg" onClick={() => window.print()}>
        <Printer aria-hidden size={18} />
        {t('print')}
      </Button>
      <Link href={backHref} className={buttonClass({ variant: 'secondary', size: 'lg' })}>
        {t(sheet ? 'pageTitle' : 'back')}
      </Link>
      <p className="m-0 text-sm text-muted">{t(sheet ? 'sheetHint' : 'printHint')}</p>
    </div>
  );
}
