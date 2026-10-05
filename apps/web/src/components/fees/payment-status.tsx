import { StatusBadge } from '@remix/ui';
import type { Payment } from '@remix/types/api';
import { useTranslations } from 'next-intl';

export function PaymentStatus({ payment }: { payment: Pick<Payment, 'method' | 'reversedByPaymentId'> }) {
  const t = useTranslations('fees');
  const status = payment.method === 'reversal' ? 'reversal' : payment.reversedByPaymentId ? 'reversed' : 'paid';
  return <StatusBadge tone={status === 'paid' ? 'success' : 'danger'}>{t(status)}</StatusBadge>;
}
