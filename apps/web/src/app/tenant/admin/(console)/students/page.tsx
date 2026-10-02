import { Users } from 'lucide-react';
import { AdminComingSoon } from '@/components/admin/admin-coming-soon';
import { adminMetadata } from '@/server/metadata';

// Admin Students (STU-01…) is a later Phase 1+ track.

export const generateMetadata = () => adminMetadata('students');

export default function StudentsPage() {
  return <AdminComingSoon section="students" icon={<Users />} />;
}
