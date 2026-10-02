import { formatLKR } from '@remix/types';
import type { ClassSummary } from '@remix/types/api';
import { CalendarDays, GraduationCap, Languages, MapPin, MonitorPlay } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { formatSlot, sortedSchedule } from '@/lib/schedule';

/**
 * One enrolled class (Student Classes 3a/3e): name, teacher, weekly times in Asia/Colombo,
 * place, medium, grade and the monthly fee. Fee status and "Open class" arrive with FEE/LES.
 */
export async function ClassCard({ cls }: { cls: ClassSummary }) {
  const [t, locale] = await Promise.all([getTranslations('portal'), getLocale()]);
  const slots = sortedSchedule(cls.schedule);

  return (
    <article className="bg-surface border-line flex h-full flex-col gap-3 rounded-lg border p-4 lg:p-[18px]">
      <div className="flex flex-col">
        <h2 className="m-0 text-[17px] font-semibold leading-[22px]">{cls.name}</h2>
        <p className="text-muted m-0 text-sm">{cls.teacherName ?? t('classes.noTeacher')}</p>
      </div>

      <ul className="text-ink-2 m-0 flex list-none flex-wrap gap-x-3.5 gap-y-1.5 p-0 text-[13px] leading-5">
        {slots.length > 0 ? (
          slots.map((slot) => {
            const { weekday, time } = formatSlot(slot, locale);
            return (
              <Meta key={`${slot.weekday}-${slot.startTime}`} icon={<CalendarDays />}>
                <span className="tabular">{t('classes.slot', { weekday, time })}</span>
              </Meta>
            );
          })
        ) : (
          <Meta icon={<CalendarDays />}>{t('classes.noSchedule')}</Meta>
        )}
        <Meta icon={cls.place === 'online' ? <MonitorPlay /> : <MapPin />}>
          {t(`place.${cls.place}`)}
        </Meta>
        <Meta icon={<Languages />}>{t(`medium.${cls.medium}`)}</Meta>
        <Meta icon={<GraduationCap />}>{cls.grade}</Meta>
      </ul>

      <p className="border-line-soft m-0 mt-auto flex items-baseline justify-between gap-3 border-t pt-3 text-sm">
        <span className="text-muted">{t('classes.feeLabel')}</span>
        <span className="tabular font-semibold">{formatLKR(cls.feeCents, { exact: true })}</span>
      </p>
    </article>
  );
}

function Meta({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className="text-muted flex flex-none [&_svg]:size-4">
        {icon}
      </span>
      {children}
    </li>
  );
}
