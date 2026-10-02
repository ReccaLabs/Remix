import { BookOpen } from 'lucide-react';
import { AdminComingSoon } from '@/components/admin/admin-coming-soon';
import { adminMetadata } from '@/server/metadata';

// Admin Classes is a later phase.

export const generateMetadata = () => adminMetadata('classes');

export default function ClassesPage() {
  return <AdminComingSoon section="classes" icon={<BookOpen />} />;
}
