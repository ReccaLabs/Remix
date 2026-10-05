import { can } from '@remix/types';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { IntlIsland } from '@/components/intl-island';
import { CardFront } from '@/components/students/card-front';
import { CardQr } from '@/components/students/card-qr';
import { CardPrintControls } from '@/components/students/card-print-controls';
import styles from '@/components/students/card-print.module.css';
import { cardSheets } from '@/lib/cards-csv';
import { getApi, getTenant, requireStaff } from '@/server/api';

export const generateMetadata = async () => ({
  title: (await getTranslations('students.cards'))('printSheet'),
  robots: { index: false, follow: false },
});
export default async function CardSheetPage() {
  const session = await requireStaff();
  if (!can(session.user.roles, 'students.read')) notFound();
  const t = await getTranslations('students.cards');
  const tenant = await getTenant();
  let orders;
  try {
    orders = await (await getApi()).call('listOrderedCards');
  } catch {
    return (
      <main id="main" className="p-4">
        <h1>{t('printSheet')}</h1>
        <p role="alert">{t('loadError')}</p>
      </main>
    );
  }
  return (
    <main id="main">
      <IntlIsland namespaces={['students']}>
        <CardPrintControls backHref="/admin/students/cards" sheet />
      </IntlIsland>
      {!orders.items.length ? (
        <p className="p-4" role="status">
          {t('orderedEmpty')}
        </p>
      ) : (
        <div className={styles.sheetPreview}>
          {cardSheets(orders.items).map((page, index) => (
            <div key={index} className={styles.sheet}>
              {page.map((card) => (
                <CardFront
                  key={card.id}
                  institute={tenant.name}
                  logoUrl={tenant.logoUrl}
                  name={card.displayName}
                  studentNo={card.studentNo}
                  code={card.code}
                  kindLabel={t('permanent')}
                  barcodeLabel={`${t('barcode')}: ${card.code}`}
                  nfcLabel={card.formats.includes('nfc') ? t('nfc') : undefined}
                  qr={
                    card.formats.includes('qr') ? (
                      <CardQr code={card.code} label={`${t('qr')}: ${card.code}`} />
                    ) : undefined
                  }
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
