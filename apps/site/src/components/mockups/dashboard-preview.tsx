import { cn } from '@remix/ui';
import {
  Bell,
  BookOpen,
  CalendarCheck,
  ChartColumn,
  Globe,
  LayoutDashboard,
  MessageSquare,
  Plus,
  Receipt,
  Search,
  Settings,
  Upload,
  Users,
  Video,
  Wallet,
} from 'lucide-react';

/**
 * Static, decorative re-creation of design/claude-design/Institute Dashboard.dc.html at
 * 1440×1000, used as a "screenshot" on remix.lk. Always rendered inside <Scaled> and hidden
 * from assistive tech (the parent provides a text description). Sample data only.
 */
const NAV = [
  { icon: LayoutDashboard, label: 'Dashboard', active: true },
  { icon: Users, label: 'Students' },
  { icon: BookOpen, label: 'Classes' },
  { icon: Wallet, label: 'Fees & payments', count: 18 },
  { icon: Upload, label: 'Lessons' },
  { icon: Video, label: 'Live classes' },
  { icon: CalendarCheck, label: 'Attendance' },
  { icon: Globe, label: 'Website' },
  { icon: MessageSquare, label: 'Messages' },
  { icon: ChartColumn, label: 'Reports' },
  { icon: Settings, label: 'Settings' },
];

const CLASSES = [
  ['6:30 AM', 'Grade 11 O/L Science', 'Hall B', '72', '66', 'Finished', 'done'],
  ['8:00 AM', '2027 A/L Physics Theory', 'Hall A', '180', '164', 'In progress', 'live'],
  ['10:30 AM', '2026 A/L Revision', 'Online', '220', '—', 'Starts in 40 min', 'soon'],
  ['2:00 PM', '2028 A/L Physics', 'Hall A + Zoom', '146', '—', 'Later today', 'later'],
  ['5:30 PM', 'Paper class · 2026', 'Online', '310', '—', 'Later today', 'later'],
] as const;

const SLIPS = [
  ['Nimali Perera', '2027 A/L Theory · Oct', 'LKR 2,500', '12 min'],
  ['Kasun Fernando', '2026 Revision · Oct', 'LKR 3,000', '25 min'],
  ['Tharushi Silva', '2028 A/L · Oct', 'LKR 2,500', '41 min'],
  ['Ravindu Jayawardena', 'Paper class · Oct', 'LKR 1,500', '1 h'],
  ['Sanduni Wickrama', '2027 A/L Theory · Oct', 'LKR 2,500', '2 h'],
] as const;

const PAYMENTS = [
  [
    'Dilini Rathnayake',
    'BR-1187',
    '2027 A/L Theory',
    'Oct 2026',
    'Card',
    'LKR 2,500.00',
    '8:42 AM',
  ],
  ['Pasindu Herath', 'BR-0934', '2026 Revision', 'Oct 2026', 'Cash', 'LKR 3,000.00', '8:31 AM'],
  [
    'Ishara Madushani',
    'BR-1211',
    '2028 A/L Physics',
    'Oct 2026',
    'Bank slip',
    'LKR 2,500.00',
    '8:15 AM',
  ],
] as const;

function Status({ kind, children }: { kind: string; children: string }) {
  const tone =
    kind === 'live'
      ? 'bg-success-soft text-success-ink'
      : kind === 'soon'
        ? 'bg-accent-soft text-accent-ink'
        : kind === 'done'
          ? 'bg-canvas text-muted'
          : 'bg-brand-soft text-brand';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold',
        tone,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function DashboardPreview() {
  return (
    <div
      aria-hidden
      className="bg-canvas text-ink flex h-[1000px] w-[1440px] font-sans text-[14px] leading-5"
    >
      {/* Sidebar */}
      <aside className="bg-surface border-line flex w-[248px] flex-none flex-col border-r">
        <div className="border-line flex h-16 items-center gap-3 border-b px-5">
          <div className="bg-brand flex size-9 items-center justify-center rounded-md text-[13px] font-bold text-white">
            KP
          </div>
          <div className="flex flex-col">
            <span className="text-[14px] font-semibold">Kamal Physics</span>
            <span className="text-muted text-[12px]">kamalphysics.remix.lk</span>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 p-3">
          {NAV.map(({ icon: Icon, label, active, count }) => (
            <span
              key={label}
              className={cn(
                'flex h-9 items-center gap-3 rounded-sm px-3 font-medium',
                active ? 'bg-brand-soft text-brand' : 'text-ink-2',
              )}
            >
              <Icon size={18} strokeWidth={1.75} />
              <span className="flex-1">{label}</span>
              {count && (
                <span className="bg-accent-soft text-accent-ink rounded-full px-2 text-[11px] font-semibold">
                  {count}
                </span>
              )}
            </span>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-3 p-4">
          <div className="border-line rounded-md border p-3">
            <div className="flex justify-between text-[12px]">
              <span className="font-semibold">Institute plan</span>
              <span className="text-muted tabular">468 / 1,500</span>
            </div>
            <div className="bg-line-soft mt-2 h-1.5 rounded-full">
              <div className="bg-brand h-full w-[31%] rounded-full" />
            </div>
            <div className="text-muted mt-2 text-[12px]">Active students this cycle</div>
          </div>
          <div className="text-muted text-[12px]">Powered by ReMix</div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="bg-surface border-line flex h-16 items-center gap-4 border-b px-8">
          <div className="bg-canvas border-line text-muted flex h-9 w-[420px] items-center gap-2 rounded-md border px-3">
            <Search size={16} />
            <span className="flex-1">Search students, classes…</span>
            <span className="border-line rounded-xs border px-1.5 text-[11px]">Ctrl K</span>
          </div>
          <div className="flex-1" />
          <div className="border-line text-ink-2 flex h-8 items-center gap-2 rounded-full border px-3 text-[12px]">
            <b className="text-ink">EN</b>
            <span className="font-sinhala">සිං</span>
            <span className="font-tamil">த</span>
          </div>
          <span className="text-ink-2 relative">
            <Bell size={20} />
            <span className="bg-danger absolute -right-0.5 -top-0.5 size-2 rounded-full" />
          </span>
          <div className="flex items-center gap-2.5">
            <div className="bg-ink flex size-8 items-center justify-center rounded-full text-[12px] font-semibold text-white">
              KJ
            </div>
            <div className="flex flex-col leading-4">
              <span className="text-[13px] font-semibold">Kamal Jayasinghe</span>
              <span className="text-muted text-[12px]">Owner</span>
            </div>
          </div>
        </header>

        <main className="flex flex-col gap-6 p-8">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="m-0 text-[26px] font-semibold leading-8 tracking-[-0.01em]">
                Good morning, Kamal
              </h1>
              <div className="text-muted mt-1">
                Sat, 26 Sep 2026 · 5 classes today · 2 in the hall, 1 online, 2 mixed
              </div>
            </div>
            <div className="flex gap-2">
              <span className="border-line bg-surface flex h-9 items-center gap-2 rounded-md border px-3 font-medium">
                <Plus size={16} /> Add student
              </span>
              <span className="border-line bg-surface flex h-9 items-center gap-2 rounded-md border px-3 font-medium">
                <Upload size={16} /> Upload lesson
              </span>
              <span className="bg-brand flex h-9 items-center gap-2 rounded-md px-3 font-semibold text-white">
                <Receipt size={16} /> Record payment
              </span>
            </div>
          </div>

          {/* KPIs */}
          <section className="grid grid-cols-4 gap-4">
            <div className="bg-surface border-line flex flex-col gap-2 rounded-md border p-5">
              <span className="text-muted text-[13px]">Fees collected · Sep 2026</span>
              <span className="tabular flex flex-wrap items-baseline gap-x-2">
                <b className="whitespace-nowrap text-[26px] font-semibold leading-8">
                  LKR 1,284,500
                </b>
                <span className="text-muted text-[13px]">of 1,560,000</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="bg-line-soft h-1.5 flex-1 rounded-full">
                  <span className="bg-success block h-full w-[82%] rounded-full" />
                </span>
                <span className="text-[12px] font-semibold">82%</span>
              </span>
              <span className="text-muted text-[12px]">
                LKR 275,500 still to collect · 4 days left
              </span>
            </div>
            <div className="bg-surface border-line flex flex-col gap-2 rounded-md border p-5">
              <span className="text-muted text-[13px]">Unpaid students</span>
              <b className="tabular text-[26px] font-semibold leading-8">64</b>
              <span className="text-danger-ink flex items-center gap-1.5 text-[12px] font-medium">
                <span className="bg-danger size-1.5 rounded-full" /> Sep 2026 fee not paid
              </span>
              <span className="text-brand text-[13px] font-medium">View list →</span>
            </div>
            <div className="bg-accent-tint border-accent-line flex flex-col gap-2 rounded-md border p-5">
              <span className="text-accent-ink text-[13px] font-medium">Bank slips waiting</span>
              <span className="tabular flex flex-wrap items-baseline gap-x-2">
                <b className="text-[26px] font-semibold leading-8">18</b>
                <span className="text-accent-ink text-[13px]">oldest 2 h ago</span>
              </span>
              <span className="bg-ink mt-auto flex h-8 items-center justify-center rounded-sm text-[13px] font-semibold text-white">
                Review now
              </span>
            </div>
            <div className="bg-surface border-line flex flex-col gap-2 rounded-md border p-5">
              <span className="text-muted text-[13px]">Present today</span>
              <span className="tabular flex flex-wrap items-baseline gap-x-2">
                <b className="text-[26px] font-semibold leading-8">412</b>
                <span className="text-muted text-[13px]">of 468</span>
              </span>
              <span className="text-success-ink flex items-center gap-1.5 text-[12px] font-medium">
                <span className="bg-success size-1.5 rounded-full" /> 88% so far · gate + Zoom
              </span>
              <span className="text-brand text-[13px] font-medium">Absent list →</span>
            </div>
          </section>

          <section className="grid grid-cols-[1fr_400px] gap-4">
            <div className="bg-surface border-line rounded-md border">
              <div className="flex items-center justify-between px-5 py-4">
                <h2 className="m-0 text-[15px] font-semibold">Today&apos;s classes</h2>
                <span className="text-brand text-[13px] font-medium">Timetable</span>
              </div>
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-canvas text-muted border-line border-y text-[12px]">
                    {['Time', 'Class', 'Place', 'Expected', 'Present', 'Status'].map((h) => (
                      <th key={h} className="px-5 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CLASSES.map(([time, cls, place, exp, present, status, kind]) => (
                    <tr key={time} className="border-line-soft border-b last:border-0">
                      <td className="tabular text-ink-2 whitespace-nowrap px-5 py-3">{time}</td>
                      <td className="whitespace-nowrap px-5 py-3 font-medium">{cls}</td>
                      <td className="text-ink-2 px-5 py-3">{place}</td>
                      <td className="tabular px-5 py-3">{exp}</td>
                      <td className="tabular px-5 py-3">{present}</td>
                      <td className="px-5 py-3">
                        <Status kind={kind}>{status}</Status>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-surface border-line rounded-md border">
              <div className="flex items-center justify-between px-5 py-4">
                <h2 className="m-0 text-[15px] font-semibold">Bank slips waiting</h2>
                <span className="text-brand text-[13px] font-medium">Open queue</span>
              </div>
              <ul className="m-0 list-none p-0">
                {SLIPS.map(([name, cls, amount, ago]) => (
                  <li
                    key={name}
                    className="border-line-soft flex items-center gap-3 border-t px-5 py-3"
                  >
                    <span className="bg-canvas border-line size-9 flex-none rounded-sm border" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <b className="font-semibold">{name}</b>
                      <span className="text-muted text-[12px]">{cls}</span>
                    </span>
                    <span className="flex flex-col items-end">
                      <b className="tabular font-semibold">{amount}</b>
                      <span className="text-muted text-[12px]">{ago} ago</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="bg-surface border-line rounded-md border">
            <div className="px-5 py-4">
              <h2 className="m-0 text-[15px] font-semibold">Recent payments</h2>
            </div>
            <table className="w-full border-collapse text-left">
              <tbody>
                {PAYMENTS.map(([name, no, cls, month, method, amount, time]) => (
                  <tr key={no} className="border-line-soft border-t">
                    <td className="px-5 py-3 font-medium">{name}</td>
                    <td className="text-muted tabular px-5 py-3">{no}</td>
                    <td className="text-ink-2 px-5 py-3">{cls}</td>
                    <td className="text-ink-2 px-5 py-3">{month}</td>
                    <td className="px-5 py-3">{method}</td>
                    <td className="tabular px-5 py-3 text-right font-semibold">{amount}</td>
                    <td className="text-muted tabular px-5 py-3 text-right">{time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </main>
      </div>
    </div>
  );
}
