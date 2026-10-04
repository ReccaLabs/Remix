// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClassDetail, TimetableSlot } from '@remix/types/api';
import { ToastProvider } from '@remix/ui';
import admin from '../../../messages/en/admin.json';
import classes from '../../../messages/en/classes.json';
import common from '../../../messages/en/common.json';
import errors from '../../../messages/en/errors.json';
import settings from '../../../messages/en/settings.json';
import { expectNoAxeViolations } from '../../../test/axe';
import { settingsHome, SettingsNav, settingsSections } from '../settings/settings-nav';
import {
  ClassHeader,
  ClassKpis,
  ClassTabs,
  LaterTab,
  parseClassTab,
  ScheduleTab,
} from './class-detail';
import { ClassViews } from './class-views';
import { ClassesList } from './classes-list';
import { SlotCard, TimetableWeek } from './timetable-week';

// Server components read translations and formats through next-intl/server. Here they get the
// same English messages and `Intl` (Asia/Colombo), so the real components render in jsdom.
const messages = { admin, classes, settings } as unknown as Record<string, Record<string, unknown>>;
vi.mock('next-intl/server', () => ({
  getLocale: () => Promise.resolve('en'),
  getTranslations: (namespace: string) =>
    Promise.resolve(
      createTranslator({ locale: 'en', messages: messages as never, namespace } as never),
    ),
  getFormatter: () =>
    Promise.resolve({
      number: (n: number, opts?: Intl.NumberFormatOptions) =>
        new Intl.NumberFormat('en', opts).format(n),
      dateTime: (d: Date, opts?: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat('en', { ...opts, timeZone: 'Asia/Colombo' }).format(d),
    }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/classes',
}));

afterEach(cleanup);

/** Renders an async server component the way React would, inside the client providers. */
async function renderServer(element: Promise<ReactElement | null>) {
  const ui = await element;
  return render(
    <NextIntlClientProvider
      locale="en"
      timeZone="Asia/Colombo"
      messages={{ common, errors, classes }}
    >
      <ToastProvider dismissLabel="Dismiss" regionLabel="Notifications">
        {ui}
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

const ID = (n: number) => `0193f1c2-7b1d-7c3e-9a4f-${String(n).padStart(12, '0')}`;
const base = {
  grade: '2027 A/L',
  medium: 'sinhala' as const,
  teacherId: ID(11),
  teacherName: 'Kamal Jayasinghe',
  feeCents: 250_000,
  place: 'hall' as const,
  hallId: ID(1),
  hallName: 'Hall A',
  startsOn: null,
  paidPercent: null,
  archivedAt: null,
};
const physics = {
  ...base,
  id: ID(201),
  name: '2027 A/L Physics Theory',
  schedule: [
    { weekday: 6, startTime: '08:00', durationMinutes: 180 },
    { weekday: 3, startTime: '19:00', durationMinutes: 120 },
  ],
  studentCount: 180,
};
const online = {
  ...base,
  id: ID(202),
  name: '2026 A/L Revision',
  teacherId: null,
  teacherName: null,
  feeCents: 125_050,
  place: 'online' as const,
  hallId: null,
  hallName: null,
  schedule: [],
  studentCount: 1,
};
const archived = { ...physics, id: ID(203), name: 'Old class', archivedAt: '2026-09-01T00:00:00Z' };

describe('ClassesList', () => {
  const props = { filtered: false, clearHref: '/admin/classes', canWrite: true };

  it('shows classes as a table and as phone cards, with places, times and fees in the local way', async () => {
    const { container } = await renderServer(
      ClassesList({ ...props, items: [physics, online, archived] }),
    );
    const table = screen.getByRole('table', { name: 'Classes' });
    const row = within(table).getByRole('row', { name: /2027 A\/L Physics Theory/ });
    expect(within(row).getByText('Kamal Jayasinghe')).toBeInTheDocument();
    // First weekly time in week order (Wednesday), "+1" for the second one.
    expect(within(row).getByText('Wed 7:00 PM +1')).toBeInTheDocument();
    expect(within(row).getByText('Hall A')).toBeInTheDocument();
    expect(within(row).getByText('180')).toBeInTheDocument();
    expect(within(row).getByText('2,500')).toBeInTheDocument();
    // No money figures yet: a dash with words for screen readers.
    expect(within(row).getByText('Not available yet')).toBeInTheDocument();

    const free = within(table).getByRole('row', { name: /2026 A\/L Revision/ });
    expect(within(free).getByText('Online')).toBeInTheDocument();
    expect(within(free).getByText('No times set')).toBeInTheDocument();
    expect(within(table).getAllByText('Archived')).toHaveLength(1);

    const cards = screen.getByRole('list', { name: 'Classes' });
    expect(within(cards).getAllByRole('link')).toHaveLength(3);
    expect(within(cards).getByText(/1 student ·/)).toBeInTheDocument();
    expect(within(cards).getByText(/LKR 1,250\.50/)).toBeInTheDocument();
    expect(within(cards).getByRole('link', { name: /2027 A\/L Physics Theory/ })).toHaveAttribute(
      'href',
      `/admin/classes/${physics.id}`,
    );
    await expectNoAxeViolations(container);
  });

  it('an empty institute is invited to create the first class; teachers only see the words', async () => {
    await renderServer(ClassesList({ ...props, items: [] }));
    expect(screen.getAllByText('No classes yet').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Create class' })[0]).toHaveAttribute(
      'href',
      '/admin/classes/new',
    );
    cleanup();
    await renderServer(ClassesList({ ...props, items: [], canWrite: false }));
    expect(screen.queryByRole('link', { name: 'Create class' })).not.toBeInTheDocument();
  });

  it('a filter with no result offers to clear the filters', async () => {
    await renderServer(ClassesList({ ...props, items: [], filtered: true }));
    expect(screen.getAllByText('No classes match').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Clear filters' })[0]).toHaveAttribute(
      'href',
      '/admin/classes',
    );
  });
});

describe('ClassViews', () => {
  it('marks the current view and links to the other', async () => {
    await renderServer(ClassViews({ current: 'week' }));
    expect(screen.getByRole('link', { name: 'Week' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'List' })).toHaveAttribute('href', '/admin/classes');
    expect(screen.getByRole('link', { name: 'Week' })).toHaveAttribute(
      'href',
      '/admin/classes/timetable',
    );
  });
});

const slot = (over: Partial<TimetableSlot>): TimetableSlot => ({
  classId: physics.id,
  className: physics.name,
  grade: '2027 A/L',
  teacherName: 'Kamal Jayasinghe',
  hallName: 'Hall A',
  place: 'hall',
  date: '2026-10-14',
  startTime: '19:00',
  durationMinutes: 120,
  studentCount: 3,
  ...over,
});

describe('TimetableWeek', () => {
  const week = '2026-10-12';

  it('shows seven days Monday first, today in words, and each slot as a link to its class', async () => {
    const slots = [
      slot({ date: '2026-10-14' }),
      slot({ date: '2026-10-17', startTime: '08:00', durationMinutes: 180, studentCount: 1 }),
      slot({
        date: '2026-10-17',
        startTime: '14:00',
        classId: online.id,
        className: online.name,
        place: 'online',
        hallName: null,
        studentCount: 0,
      }),
    ];
    const { container } = await renderServer(
      TimetableWeek({ weekStart: week, slots, today: '2026-10-15', thisWeek: week }),
    );
    const days = screen.getAllByRole('heading', { level: 3 });
    expect(days.map((d) => d.textContent)).toEqual([
      'Mon, Oct 12',
      'Tue, Oct 13',
      'Wed, Oct 14',
      'Thu, Oct 15' + 'Today',
      'Fri, Oct 16',
      'Sat, Oct 17',
      'Sun, Oct 18',
    ]);
    const saturday = days[5]?.closest('li');
    if (!saturday) throw new Error('no Saturday');
    expect(within(saturday).getByText('8:00 AM – 11:00 AM')).toBeInTheDocument();
    expect(within(saturday).getByText('1 student')).toBeInTheDocument();
    expect(within(saturday).getByText('Hall A')).toBeInTheDocument();
    expect(within(saturday).getByText('Online')).toBeInTheDocument();
    expect(within(saturday).getByRole('link', { name: /2026 A\/L Revision/ })).toHaveAttribute(
      'href',
      `/admin/classes/${online.id}`,
    );
    expect(screen.getAllByText('No classes')).toHaveLength(5);
    expect(screen.getByText('Week of Oct 12 to Oct 18')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('week navigation: this week is the plain URL, other weeks carry ?week=', async () => {
    await renderServer(
      TimetableWeek({ weekStart: '2026-10-19', slots: [], today: '2026-10-15', thisWeek: week }),
    );
    expect(screen.getByRole('link', { name: 'Previous week' })).toHaveAttribute(
      'href',
      '/admin/classes/timetable',
    );
    expect(screen.getByRole('link', { name: 'Next week' })).toHaveAttribute(
      'href',
      '/admin/classes/timetable?week=2026-10-26',
    );
    expect(screen.getByRole('link', { name: 'This week' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('No classes this week')).toBeInTheDocument();
  });

  it('the current week is marked', async () => {
    await renderServer(
      TimetableWeek({ weekStart: week, slots: [], today: '2026-10-15', thisWeek: week }),
    );
    expect(screen.getByRole('link', { name: 'This week' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Previous week' })).toHaveAttribute(
      'href',
      '/admin/classes/timetable?week=2026-10-05',
    );
  });

  it('SlotCard can leave the student count out', async () => {
    await renderServer(SlotCard({ slot: slot({}), showCount: false }));
    expect(screen.queryByText(/student/)).not.toBeInTheDocument();
  });
});

describe('class detail', () => {
  const cls: ClassDetail = {
    ...physics,
    kpis: { enrolled: 180, paid: null, unpaid: null, avgAttendancePercent: null },
  };

  it('header: facts in one line, and edit/archive only with write permission', async () => {
    await renderServer(ClassHeader({ cls, canWrite: true }));
    expect(screen.getByRole('heading', { level: 1, name: cls.name })).toBeInTheDocument();
    expect(
      screen.getByText('Kamal Jayasinghe · Wed 7:00 PM +1 · Hall A · Sinhala · LKR 2,500 / month'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      `/admin/classes/${cls.id}/edit`,
    );
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    cleanup();
    await renderServer(ClassHeader({ cls, canWrite: false }));
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
  });

  it('header: an archived class says so and cannot be archived again', async () => {
    await renderServer(
      ClassHeader({ cls: { ...cls, archivedAt: '2026-09-01T00:00:00Z' }, canWrite: true }),
    );
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getByText(/This class is archived/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
  });

  it('header: a class without teacher or times still reads well', async () => {
    await renderServer(
      ClassHeader({ cls: { ...cls, ...online, kpis: cls.kpis }, canWrite: false }),
    );
    expect(
      screen.getByText('No teacher · No times set · Online · Sinhala · LKR 1,250.50 / month'),
    ).toBeInTheDocument();
  });

  it('KPIs: the enrolled count is real; fee and attendance figures are dashes with words', async () => {
    const { container } = await renderServer(ClassKpis({ cls }));
    const list = screen.getByRole('list');
    expect(within(list).getByText('180')).toBeInTheDocument();
    expect(within(list).getAllByText('Not available yet')).toHaveLength(3);
    expect(within(list).getAllByText('Shows here once fees are set up')).toHaveLength(2);
    await expectNoAxeViolations(container);
  });

  it('tabs are links; the current one is marked', async () => {
    await renderServer(ClassTabs({ classId: cls.id, current: 'schedule' }));
    expect(screen.getByRole('link', { name: 'Schedule' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Students' })).toHaveAttribute(
      'href',
      `/admin/classes/${cls.id}`,
    );
    expect(screen.getByRole('link', { name: 'Fees' })).toHaveAttribute(
      'href',
      `/admin/classes/${cls.id}?tab=fees`,
    );
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Students',
      'Schedule',
      'Lessons',
      'Fees',
      'Attendance',
    ]);
  });

  it('parseClassTab falls back to students', () => {
    expect(parseClassTab('fees')).toBe('fees');
    expect(parseClassTab(['attendance', 'x'])).toBe('attendance');
    expect(parseClassTab('nope')).toBe('students');
    expect(parseClassTab(undefined)).toBe('students');
  });

  it('schedule tab: weekly times in week order with their end time and length', async () => {
    const { container } = await renderServer(
      ScheduleTab({ cls: { ...cls, startsOn: '2026-11-01' } }),
    );
    const table = screen.getByRole('table', { name: 'Weekly times of this class' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      'Wednesday7:00 PM – 9:00 PM120 min',
      'Saturday8:00 AM – 11:00 AM180 min',
    ]);
    expect(screen.getByText(/Hall: Hall A · Starts on November 1, 2026/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('schedule tab: online classes and empty schedules', async () => {
    await renderServer(ScheduleTab({ cls: { ...cls, ...online, kpis: cls.kpis } }));
    expect(screen.getByText('Taught online')).toBeInTheDocument();
    expect(screen.getByText(/No times set/)).toBeInTheDocument();
  });

  it('later-phase tabs are honest empty states', async () => {
    await renderServer(LaterTab({ tab: 'fees' }));
    expect(screen.getByText('Fees come in a later phase')).toBeInTheDocument();
    cleanup();
    await renderServer(LaterTab({ tab: 'attendance' }));
    expect(screen.getByText('Attendance comes in a later phase')).toBeInTheDocument();
    cleanup();
    await renderServer(LaterTab({ tab: 'lessons' }));
    expect(screen.getByText('Lessons come in a later phase')).toBeInTheDocument();
  });
});

describe('settings sections by role', () => {
  it('owners get General, Theme, Halls and Staff; admins only Halls; the rest nothing', () => {
    expect(settingsSections(['owner'])).toEqual(['general', 'theme', 'halls', 'staff']);
    expect(settingsSections(['admin'])).toEqual(['halls']);
    for (const role of ['teacher', 'cashier', 'gatekeeper'] as const) {
      expect(settingsSections([role]), role).toEqual([]);
    }
    expect(settingsSections(['teacher', 'owner'])).toEqual(['general', 'theme', 'halls', 'staff']);
  });

  it('Settings leads to the first page a person may open', () => {
    expect(settingsHome(['owner'])).toBe('/admin/settings');
    expect(settingsHome(['admin'])).toBe('/admin/settings/halls');
    expect(settingsHome(['cashier'])).toBeNull();
  });

  it('the tab strip appears only when there is more than one page', async () => {
    await renderServer(SettingsNav({ roles: ['owner'], current: 'theme' }));
    expect(screen.getByRole('link', { name: 'Theme' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'General',
      'Theme',
      'Halls',
      'Staff and roles',
    ]);
    cleanup();
    await renderServer(SettingsNav({ roles: ['admin'], current: 'halls' }));
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
