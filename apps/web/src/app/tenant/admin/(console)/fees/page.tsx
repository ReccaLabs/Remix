import { Wallet } from 'lucide-react';
import { AdminComingSoon } from '@/components/admin/admin-coming-soon';
import { adminMetadata } from '@/server/metadata';

// Admin Fees (invoices, payments, bank-slip queue, cash counter) is a later phase.

export const generateMetadata = () => adminMetadata('fees');

export default function FeesPage() {
  return <AdminComingSoon section="fees" icon={<Wallet />} />;
}
