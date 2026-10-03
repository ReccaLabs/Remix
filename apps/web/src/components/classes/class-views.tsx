import { cn } from '@remix/ui';
import { CalendarDays, List } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ADMIN_PATHS } from '@/lib/paths';

/** List / Week switch above the classes list and the timetable (they are two views of classes). */
export async function ClassViews({ current }: { current: 'list' | 'week' }) {
  const t = await getTranslations('classes.list.views');
  const item = (view: 'list' | 'week', href: string, icon: React.ReactNode) => (
    <Link
      href={href}
      aria-current={current === view ? 'page' : undefined}
      className={cn(
        'inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium',
        current === view ? 'bg-brand-soft text-brand font-semibold' : 'text-muted hover:text-ink',
      )}
    >
      {icon}
      {t(view)}
    </Link>
  );
  return (
    <nav aria-label={t('label')} className="flex gap-1">
      {item('list', ADMIN_PATHS.classes, <List aria-hidden size={16} />)}
      {item('week', ADMIN_PATHS.timetable, <CalendarDays aria-hidden size={16} />)}
    </nav>
  );
}
