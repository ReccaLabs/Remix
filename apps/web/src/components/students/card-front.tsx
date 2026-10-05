import Image from 'next/image';
import type { ReactNode } from 'react';
import { CardBarcode } from './card-barcode';
import styles from './card-print.module.css';

export interface CardFrontProps {
  institute: string;
  logoUrl?: string | null;
  name: string;
  studentNo: string;
  code: string;
  kindLabel: string;
  barcodeLabel: string;
  nfcLabel?: string;
  qr?: ReactNode;
}
export function CardFront({
  institute,
  logoUrl,
  name,
  studentNo,
  code,
  kindLabel,
  barcodeLabel,
  nfcLabel,
  qr,
}: CardFrontProps) {
  return (
    <div className={styles.frame}>
      <svg aria-hidden="true" className={styles.crop} viewBox="-3 -3 91.6 60">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="0.15"
          d="M-3 0h2 M0-3v2 M86.6 0h2 M85.6-3v2 M-3 54h2 M0 55v2 M86.6 54h2 M85.6 55v2"
        />
      </svg>
      <article aria-label={`${kindLabel}: ${name}`} className={styles.card}>
        <div className={styles.institute}>
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt=""
              width={40}
              height={40}
              unoptimized
              className={styles.logo}
            />
          ) : null}
          <span>{institute}</span>
        </div>
        <div className={styles.identity}>
          <div>
            <p className={styles.name}>{name}</p>
            <p className={styles.number}>{studentNo}</p>
            <p className={styles.kind}>
              {kindLabel}
              {nfcLabel ? ` / ${nfcLabel}` : ''}
            </p>
          </div>
          {qr ? <div className={styles.qr}>{qr}</div> : null}
        </div>
        <figure className={styles.barcode}>
          <div className={styles.bars}>
            <CardBarcode code={code} label={barcodeLabel} />
          </div>
          <figcaption className={styles.code}>{code}</figcaption>
        </figure>
      </article>
    </div>
  );
}
