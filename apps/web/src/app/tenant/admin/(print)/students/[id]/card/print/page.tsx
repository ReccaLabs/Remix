import { can } from '@remix/types';
import { ApiError, idParamsSchema } from '@remix/types/api';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { IntlIsland } from '@/components/intl-island';
import { CardFront } from '@/components/students/card-front';
import { CardPrintControls } from '@/components/students/card-print-controls';
import styles from '@/components/students/card-print.module.css';
import { getApi, getTenant, requireStaff } from '@/server/api';

export const generateMetadata = async () => ({
  title: (await getTranslations('students.cards'))('printTitle'),
  robots: { index: false, follow: false },
});
export default async function TemporaryCardPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireStaff();
  if (!can(session.user.roles, 'students.read')) notFound();
  const parsed = idParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const t = await getTranslations('students.cards');
  const tenant = await getTenant();
  let student;
  let cards;
  try {
    const api = await getApi();
    [student, cards] = await Promise.all([
      api.call('getStudent', { params: parsed.data }),
      api.call('listStudentCards', { params: parsed.data }),
    ]);
  } catch (error) {
    if (error instanceof ApiError && [400, 403, 404].includes(error.status)) notFound();
    return (
      <main id="main" className="p-4">
        <h1>{t('printTitle')}</h1>
        <p role="alert">{t('loadError')}</p>
      </main>
    );
  }
  const card = cards.items.find((c) => c.kind === 'temporary' && c.status === 'active');
  return (
    <main id="main">
      <IntlIsland namespaces={['students']}>
        <CardPrintControls backHref={`/admin/students/${student.id}`} />
      </IntlIsland>
      {card && !/^[\x20-\x7E]+$/.test(card.code) ? (
        <p role="alert" className="p-4">
          {t('printUnsupported')}
        </p>
      ) : card ? (
        <div className={styles.preview}>
          <CardFront
            institute={tenant.name}
            logoUrl={tenant.logoUrl}
            name={student.displayName}
            studentNo={student.studentNo}
            code={card.code}
            kindLabel={t('temporary')}
            barcodeLabel={`${t('barcode')}: ${card.code}`}
          />
        </div>
      ) : (
        <p className="p-4" role="status">
          {t('noTemporary')}
        </p>
      )}
    </main>
  );
}
