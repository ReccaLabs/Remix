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
      <svg aria-hidden="true" className={styles.crop} viewBox="-1 -1 87.6 56">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="0.15"
          d="M-1 0h0.7 M0-1v0.7 M85.9 0h0.7 M85.6-1v0.7 M-1 54h0.7 M0 54.3v0.7 M85.9 54h0.7 M85.6 54.3v0.7"
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
