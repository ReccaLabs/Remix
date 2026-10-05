import type { Receipt } from '@remix/types/api';
import { formatLKR } from '@remix/types/money';
import Image from 'next/image';
import { useFormatter, useTranslations } from 'next-intl';
import styles from './receipt-print.module.css';

/** The contract's receipt data also drives the queued PDF. Browser fonts can support Unicode. */
export function ReceiptPrint({ receipt }: { receipt: Receipt }) {
  const t = useTranslations('settings.receiptPrint');
  const format = useFormatter();
  return (
    <article className={styles.paper} aria-labelledby="receipt-title">
      <header className={styles.header}>
        {receipt.institute.logoUrl ? (
          <Image
            src={receipt.institute.logoUrl}
            alt={t('logo', { name: receipt.institute.name })}
            className={styles.logo}
            width={64}
            height={64}
            unoptimized
          />
        ) : null}
        <p className={styles.institute}>{receipt.institute.name}</p>
        {receipt.institute.address ? <p>{receipt.institute.address}</p> : null}
        {receipt.institute.phone ? <p>{receipt.institute.phone}</p> : null}
        <h1 id="receipt-title">{t('title', { number: receipt.number })}</h1>
      </header>
      {receipt.reversedAt ? (
        <p className={styles.reversed}>
          {t('reversed', {
            at: format.dateTime(new Date(receipt.reversedAt), {
              dateStyle: 'medium',
              timeZone: 'Asia/Colombo',
            }),
          })}
        </p>
      ) : null}
      <dl className={styles.details}>
        <dt>{t('issued')}</dt>
        <dd>
          {format.dateTime(new Date(receipt.issuedAt), {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'Asia/Colombo',
          })}
        </dd>
        <dt>{t('student')}</dt>
        <dd>
          {receipt.studentName}
          <br />
          {receipt.studentNo}
        </dd>
        <dt>{t('method')}</dt>
        <dd>{t(`methods.${receipt.method}`)}</dd>
      </dl>
      <table className={styles.lines}>
        <caption>{t('lines')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('classMonth')}</th>
            <th scope="col">{t('amount')}</th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((line, index) => (
            <tr key={`${line.month}-${index}`}>
              <td>
                {line.className}
                <br />
                {format.dateTime(new Date(`${line.month}T00:00:00Z`), {
                  month: 'short',
                  year: 'numeric',
                  timeZone: 'Asia/Colombo',
                })}
              </td>
              <td>{formatLKR(line.amountCents, { exact: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className={styles.totals}>
        <dt>{t('total')}</dt>
        <dd>{formatLKR(receipt.amountCents, { exact: true })}</dd>
        {receipt.cashReceivedCents !== null ? (
          <>
            <dt>{t('cashReceived')}</dt>
            <dd>{formatLKR(receipt.cashReceivedCents, { exact: true })}</dd>
            <dt>{t('change')}</dt>
            <dd>{formatLKR(receipt.changeCents ?? 0, { exact: true })}</dd>
          </>
        ) : null}
      </dl>
      {receipt.institute.footer ? (
        <footer className={styles.footer}>{receipt.institute.footer}</footer>
      ) : null}
    </article>
  );
}
