'use client';
import { buttonClass, Button, StatusBadge } from '@remix/ui';
import { Download, Printer } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { cardsCsv, type CardOrder } from '@/lib/cards-csv';

export function OrderedCards({ cards }: { cards: CardOrder[] }) {
  const t = useTranslations('students.cards');
  const format = useFormatter();
  function download() {
    const url = URL.createObjectURL(
      new Blob([cardsCsv(cards)], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'remix-card-orders.csv';
    document.body.append(link);
    link.click();
    link.remove();
    // Give the browser time to consume the Blob before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section aria-label={t('orderedList')} className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <Link
          href="/admin/students/cards/print"
          className={buttonClass({ variant: 'secondary', size: 'lg' })}
        >
          <Printer aria-hidden size={18} />
          {t('printSheet')}
        </Link>
        <Button size="lg" variant="secondary" disabled={!cards.length} onClick={download}>
          <Download aria-hidden size={18} />
          {t('downloadCsv')}
        </Button>
      </div>
      {!cards.length ? (
        <p className="m-0 text-muted">{t('orderedEmpty')}</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 lg:grid-cols-2">
          {cards.map((card) => (
            <li
              key={card.id}
              className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4"
            >
              <Link
                href={`/admin/students/${card.studentId}`}
                className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
              >
                {card.displayName}
              </Link>
              <p className="m-0 font-mono text-sm">
                {t('number')}: {card.studentNo}
              </p>
              <p className="m-0 font-mono text-sm break-all">
                {t('code')}: {card.code}
              </p>
              <p className="m-0 text-sm text-muted">
                {t('formats')}: {card.formats.map((f) => t(f)).join(' / ')}
              </p>
              <p className="m-0 text-sm text-muted">
                {t('issued', {
                  date: format.dateTime(new Date(card.issuedAt), {
                    timeZone: 'Asia/Colombo',
                    dateStyle: 'medium',
                  }),
                })}
              </p>
              <div>
                <StatusBadge tone="warning">{t('ordered')}</StatusBadge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
