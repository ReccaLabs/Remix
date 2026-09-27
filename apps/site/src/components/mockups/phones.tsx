import { cn } from '@remix/ui';
import {
  BookOpen,
  CalendarCheck,
  FileText,
  House,
  Play,
  User,
  Video,
  Wallet,
  BellRing,
} from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Decorative phone mockups (236×460) from the hero of design/claude-design/ReMix Home.dc.html.
 * aria-hidden; parents provide the accessible description. Sample data only.
 */
export function PhoneFrame({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      aria-hidden
      className={cn(
        'border-ink bg-canvas shadow-float flex h-[460px] w-[236px] flex-col overflow-hidden rounded-[34px] border-[7px] font-sans',
        className,
      )}
    >
      {children}
    </div>
  );
}

function StatusBar() {
  return (
    <div className="flex justify-between text-[10px] font-semibold leading-3">
      <span>9:41</span>
      <span>4G</span>
    </div>
  );
}

function TabBar({ active }: { active: 'home' | 'pay' }) {
  const tabs = [
    { key: 'home', icon: House, label: 'Home' },
    { key: 'classes', icon: BookOpen, label: 'Classes' },
    { key: 'pay', icon: Wallet, label: 'Pay' },
    { key: 'live', icon: Video, label: 'Live' },
    { key: 'me', icon: User, label: 'Me' },
  ];
  return (
    <div className="border-line bg-surface text-muted mt-auto flex h-[46px] items-center justify-around border-t text-[9px]">
      {tabs.map(({ key, icon: Icon, label }) => (
        <span
          key={key}
          className={cn(
            'flex flex-col items-center gap-0.5',
            key === active && 'text-brand font-semibold',
          )}
        >
          <Icon size={15} strokeWidth={2} />
          {label}
        </span>
      ))}
    </div>
  );
}

export function StudentPhone({ className }: { className?: string }) {
  return (
    <PhoneFrame className={className}>
      <div className="bg-brand flex flex-col gap-2 px-3.5 pb-10 pt-3.5 text-white">
        <StatusBar />
        <div className="flex items-center gap-2">
          <span className="text-brand flex size-[22px] items-center justify-center rounded-[6px] bg-white text-[9px] font-bold">
            KP
          </span>
          <span className="text-[12px] font-semibold">Kamal Physics</span>
        </div>
        <div className="font-display text-[20px] font-bold leading-6 tracking-[-0.02em]">
          Hi Nimali
        </div>
      </div>
      <div className="mx-2.5 -mt-[30px] flex flex-col gap-2">
        <div className="bg-surface border-line flex flex-col gap-1.5 rounded-[12px] border px-3 py-2.5">
          <span className="text-danger-ink inline-flex items-center gap-[5px] text-[9px] font-bold leading-3 tracking-[0.06em]">
            <span className="bg-danger size-1.5 rounded-full" />
            LIVE NOW
          </span>
          <span className="text-[13px] font-semibold leading-4">2027 A/L Physics</span>
          <span className="text-muted text-[11px] leading-[14px]">Theory · Hall A &amp; Zoom</span>
          <span className="bg-brand flex h-8 items-center justify-center rounded-sm text-[12px] font-semibold text-white">
            Join class
          </span>
        </div>
        <div className="bg-accent-tint border-accent-line flex items-center justify-between gap-2 rounded-[12px] border px-3 py-2.5">
          <div className="flex flex-col">
            <span className="text-accent-ink text-[11px] font-medium leading-[14px]">
              October fee due
            </span>
            <span className="tabular text-[14px] font-semibold leading-[18px]">LKR 2,500</span>
          </div>
          <span className="border-ink border-b text-[11px] font-semibold leading-[14px]">
            Pay now
          </span>
        </div>
        <div className="text-muted px-0.5 pt-1 text-[11px] font-semibold leading-[14px]">
          New lessons
        </div>
        <div className="bg-surface border-line flex flex-col rounded-[12px] border">
          <LessonRow
            icon={<Play size={12} />}
            title="Electromagnetism · Part 3"
            meta="48 min"
            divider
          />
          <LessonRow icon={<FileText size={12} />} title="Paper 12 · Tute PDF" meta="2.1 MB" />
        </div>
      </div>
      <TabBar active="home" />
    </PhoneFrame>
  );
}

function LessonRow({
  icon,
  title,
  meta,
  divider,
}: {
  icon: ReactNode;
  title: string;
  meta: string;
  divider?: boolean;
}) {
  return (
    <div
      className={cn('flex items-center gap-2 px-2.5 py-2', divider && 'border-line-soft border-b')}
    >
      <span className="bg-brand-soft text-brand flex size-[26px] items-center justify-center rounded-[7px]">
        {icon}
      </span>
      <span className="flex flex-col text-[11px] leading-[14px]">
        <b className="font-semibold">{title}</b>
        <span className="text-muted">{meta}</span>
      </span>
    </div>
  );
}

export function ParentPhone({ className }: { className?: string }) {
  return (
    <PhoneFrame className={className}>
      <div className="bg-ink flex flex-col gap-2 px-3.5 pb-10 pt-3.5 text-white">
        <StatusBar />
        <div className="text-night-muted text-[12px] font-semibold">Parent · Kamal Physics</div>
        <div className="flex gap-1.5">
          <span className="text-ink rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold">
            Nimali
          </span>
          <span className="border-night-line rounded-full border px-2.5 py-1 text-[11px] font-semibold">
            Sahan
          </span>
        </div>
      </div>
      <div className="mx-2.5 -mt-[30px] flex flex-col gap-2">
        <div className="bg-surface border-line flex gap-2 rounded-[12px] border px-3 py-2.5">
          <span className="bg-danger-soft text-danger-ink flex size-[26px] flex-none items-center justify-center rounded-[7px]">
            <BellRing size={13} />
          </span>
          <span className="flex flex-col text-[11px] leading-[14px]">
            <b className="text-[12px] font-semibold">Absent today</b>
            <span className="text-muted">2027 A/L Physics · Hall A · 8:00 AM</span>
          </span>
        </div>
        <div className="bg-surface border-line flex flex-col gap-1.5 rounded-[12px] border px-3 py-2.5">
          <span className="text-muted text-[11px] font-semibold">Attendance · September</span>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 21 }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'h-3.5 rounded-[3px]',
                  i === 17 ? 'bg-danger' : i > 18 ? 'bg-line' : 'bg-success',
                )}
              />
            ))}
          </div>
          <span className="text-success-ink flex items-center gap-1 text-[11px] font-medium">
            <CalendarCheck size={11} /> 17 of 18 classes present
          </span>
        </div>
        <div className="bg-surface border-line flex flex-col rounded-[12px] border">
          <div className="border-line-soft flex items-center justify-between border-b px-3 py-2 text-[11px]">
            <span>Sep 2026</span>
            <span className="text-success-ink font-semibold">Paid ✓</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 text-[11px]">
            <span>Oct 2026</span>
            <span className="text-accent-ink font-semibold">Due · LKR 2,500</span>
          </div>
        </div>
      </div>
      <TabBar active="home" />
    </PhoneFrame>
  );
}
