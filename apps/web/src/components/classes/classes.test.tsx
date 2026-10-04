// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminClass, ClassStudent, Hall, Theme } from '@remix/types/api';
import { ToastProvider } from '@remix/ui';
import classes from '../../../messages/en/classes.json';
import common from '../../../messages/en/common.json';
import errors from '../../../messages/en/errors.json';
import settings from '../../../messages/en/settings.json';
import { expectNoAxeViolations } from '../../../test/axe';
import { GeneralForm } from '../settings/general-form';
import { HallsPanel } from '../settings/halls-panel';
import { ThemeForm } from '../settings/theme-form';
import { ClassForm } from './class-form';
import { ClassStudentsPanel } from './class-students-panel';
import { ClassesToolbar } from './classes-toolbar';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin' }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  router.push.mockReset();
  router.refresh.mockReset();
});

function wrap(ui: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale="en"
      timeZone="Asia/Colombo"
      messages={{ common, errors, classes, settings }}
    >
      <ToastProvider dismissLabel="Dismiss" regionLabel="Notifications">
        {ui}
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
const problem = (status: number, code: string, extra: object = {}) =>
  json({ type: 'about:blank', title: code, status, code, requestId: 'r1', ...extra }, status);

function stubFetch(respond: (url: string, init: RequestInit) => Response) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) =>
    respond(String(input), init ?? {}),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const bodyOf = (fetch: ReturnType<typeof stubFetch>, call = 0): unknown =>
  JSON.parse(String(fetch.mock.calls[call]?.[1]?.body));

const ID = (n: number) => `0193f1c2-7b1d-7c3e-9a4f-${String(n).padStart(12, '0')}`;
const HALL_A: Hall = { id: ID(1), name: 'Hall A', capacity: 200 };
const HALL_B: Hall = { id: ID(2), name: 'Hall B', capacity: null };
const TEACHER = { id: ID(11), name: 'Kamal Jayasinghe' };

const aClass: AdminClass = {
  id: ID(201),
  name: '2027 A/L Physics Theory',
  grade: '2027 A/L',
  medium: 'sinhala',
  teacherId: TEACHER.id,
  teacherName: TEACHER.name,
  feeCents: 250_000,
  place: 'hall',
  hallId: HALL_A.id,
  hallName: HALL_A.name,
  startsOn: null,
  schedule: [{ weekday: 6, startTime: '08:00', durationMinutes: 180 }],
  studentCount: 2,
  paidPercent: null,
  archivedAt: null,
};
const detail = {
  ...aClass,
  kpis: { enrolled: 2, paid: null, unpaid: null, avgAttendancePercent: null },
};

describe('ClassForm — create', () => {
  const props = { mode: 'create', halls: [HALL_A, HALL_B], teachers: [TEACHER] } as const;

  it('sends fee in cents, schedule as numbers and a null hall for online; then opens the class', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json(detail, 201));
    const { container } = wrap(<ClassForm {...props} />);
    await expectNoAxeViolations(container);

    await user.type(screen.getByLabelText('Class name'), '2029 A/L Physics');
    await user.type(screen.getByLabelText('Grade or A/L year'), 'A/L 2029');
    await user.selectOptions(screen.getByLabelText(/^Teacher/), TEACHER.id);
    await user.selectOptions(screen.getByLabelText('Where'), 'online');
    expect(screen.queryByLabelText(/^Hall/)).not.toBeInTheDocument(); // online classes have no hall
    await user.click(screen.getByRole('button', { name: 'Add a time' }));
    await user.type(screen.getByLabelText('Monthly fee (LKR)'), '2,500.50');
    await expectNoAxeViolations(container);

    await user.click(screen.getByRole('button', { name: 'Create class' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/admin/classes/${aClass.id}`));
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe('/api/v1/admin/classes');
    expect(init?.method).toBe('POST');
    expect(bodyOf(fetch)).toEqual({
      name: '2029 A/L Physics',
      grade: 'A/L 2029',
      medium: 'sinhala',
      teacherId: TEACHER.id,
      feeCents: 250_050,
      place: 'online',
      hallId: null,
      startsOn: null,
      schedule: [{ weekday: 6, startTime: '08:00', durationMinutes: 120 }],
    });
  });

  it('shows what is wrong and sends nothing: missing name, bad fee, same time twice', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json(detail, 201));
    wrap(<ClassForm {...props} />);
    await user.type(screen.getByLabelText('Monthly fee (LKR)'), 'lots');
    await user.click(screen.getByRole('button', { name: 'Add a time' }));
    await user.click(screen.getByRole('button', { name: 'Add a time' }));
    await user.click(screen.getByRole('button', { name: 'Create class' }));

    expect(await screen.findAllByText('This field is required.')).toHaveLength(2);
    expect(screen.getByText(/Enter an amount in rupees/)).toBeInTheDocument();
    expect(screen.getByText('This day and time is listed twice.')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('adds and removes weekly times; the add button stops at 14', async () => {
    const user = userEvent.setup();
    wrap(<ClassForm {...props} />);
    expect(screen.getByText(/No times yet/)).toBeInTheDocument();
    for (let i = 0; i < 14; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Add a time' }));
    }
    expect(screen.getByRole('button', { name: 'Add a time' })).toBeDisabled();
    expect(screen.getByText('A class can have up to 14 weekly times.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove time 14' }));
    expect(screen.getByRole('button', { name: 'Add a time' })).toBeEnabled();
  });

  it('puts API field errors on the field (a teacher who left)', async () => {
    const user = userEvent.setup();
    stubFetch(() =>
      problem(400, 'VALIDATION_FAILED', {
        errors: [{ path: 'teacherId', message: 'Choose a teacher from your staff' }],
      }),
    );
    wrap(<ClassForm {...props} />);
    await user.type(screen.getByLabelText('Class name'), 'X');
    await user.type(screen.getByLabelText('Grade or A/L year'), 'Y');
    await user.type(screen.getByLabelText('Monthly fee (LKR)'), '100');
    await user.click(screen.getByRole('button', { name: 'Create class' }));
    expect(await screen.findByText('Choose a teacher from your staff.')).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('points to Settings when there are no halls yet', () => {
    wrap(<ClassForm mode="create" halls={[]} teachers={[]} />);
    expect(screen.getByRole('link', { name: 'Add a hall' })).toHaveAttribute(
      'href',
      '/admin/settings/halls',
    );
  });
});

describe('ClassForm — edit', () => {
  it('starts from the class and patches it with the whole form', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json(detail));
    const { container } = wrap(
      <ClassForm mode="edit" cls={aClass} halls={[HALL_A, HALL_B]} teachers={[TEACHER]} />,
    );
    expect(screen.getByLabelText('Class name')).toHaveValue(aClass.name);
    expect(screen.getByLabelText('Monthly fee (LKR)')).toHaveValue('2500');
    expect(screen.getByLabelText(/^Teacher/)).toHaveValue(TEACHER.id);
    await expectNoAxeViolations(container);

    await user.clear(screen.getByLabelText('Monthly fee (LKR)'));
    await user.type(screen.getByLabelText('Monthly fee (LKR)'), '3000');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe(`/api/v1/admin/classes/${aClass.id}`);
    expect(init?.method).toBe('PATCH');
    expect(bodyOf(fetch)).toMatchObject({
      feeCents: 300_000,
      hallId: HALL_A.id,
      schedule: [{ weekday: 6, startTime: '08:00', durationMinutes: 180 }],
    });
  });

  it('keeps a teacher who is missing from the list selectable', () => {
    wrap(<ClassForm mode="edit" cls={aClass} halls={[]} teachers={[]} />);
    expect(screen.getByRole('option', { name: TEACHER.name })).toBeInTheDocument();
  });
});

describe('ClassesToolbar', () => {
  it('searches and filters through the URL', async () => {
    const user = userEvent.setup();
    const { container } = wrap(
      <ClassesToolbar
        query={{ archived: 'false' }}
        grades={['2027 A/L', '2028 A/L']}
        teachers={[TEACHER]}
      />,
    );
    await expectNoAxeViolations(container);
    await user.type(screen.getByLabelText('Search by class name'), 'physics{Enter}');
    expect(router.push).toHaveBeenLastCalledWith('/admin/classes?q=physics');
    await user.selectOptions(screen.getByLabelText('Where'), 'online');
    // The search text typed before stays in the URL.
    expect(router.push).toHaveBeenLastCalledWith('/admin/classes?q=physics&place=online');
  });

  it('offers to clear active filters', () => {
    wrap(<ClassesToolbar query={{ place: 'hall', archived: 'true' }} grades={[]} teachers={[]} />);
    expect(screen.getByRole('link', { name: 'Clear filters' })).toHaveAttribute(
      'href',
      '/admin/classes',
    );
  });
});

const NIMALI: ClassStudent = {
  enrollmentId: ID(901),
  studentId: ID(101),
  studentNo: 'BR-1042',
  displayName: 'Nimali Perera',
  phone: '+94771234521',
  fromMonth: '2026-01-01',
  toMonth: null,
  feeCents: 250_000,
  feeOverrideCents: null,
  reason: null,
};
const SIBLING: ClassStudent = {
  ...NIMALI,
  enrollmentId: ID(902),
  studentId: ID(102),
  displayName: 'Tharindu Silva',
  studentNo: 'BR-0988',
  phone: '+94715542019',
  feeCents: 100_000,
  feeOverrideCents: 100_000,
  reason: 'Sibling discount',
};
/** What PATCH/POST /admin/enrollments/... answer (the client checks responses against the contract). */
const enrollmentBody = (over: object = {}) => ({
  id: ID(901),
  classId: aClass.id,
  className: aClass.name,
  fromMonth: '2026-01-01',
  toMonth: null,
  feeCents: 250_000,
  feeOverrideCents: null,
  reason: null,
  ...over,
});
const panel = {
  classId: aClass.id,
  className: aClass.name,
  classFeeCents: aClass.feeCents,
  students: [NIMALI, SIBLING],
  moveTargets: [{ id: ID(202), name: '2027 A/L Revision' }],
  canEnrol: true,
  archived: false,
};

describe('ClassStudentsPanel', () => {
  it('lists students with the effective fee and marks a custom fee in words', async () => {
    const { container } = wrap(<ClassStudentsPanel {...panel} />);
    const table = screen.getByRole('table', { name: 'Students in this class' });
    expect(within(table).getByText('077 123 4521')).toBeInTheDocument();
    expect(within(table).getByText('LKR 2,500')).toBeInTheDocument();
    expect(within(table).getByText('LKR 1,000')).toBeInTheDocument();
    expect(within(table).getByText('Custom fee')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('hides every action for roles that cannot enrol, and for archived classes', () => {
    wrap(<ClassStudentsPanel {...panel} canEnrol={false} />);
    expect(screen.queryByRole('button', { name: 'Add students' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Change fee/ })).not.toBeInTheDocument();
    cleanup();
    wrap(<ClassStudentsPanel {...panel} archived />);
    expect(screen.queryByRole('button', { name: 'Add students' })).not.toBeInTheDocument();
    expect(screen.getByText(/students cannot be added/)).toBeInTheDocument();
  });

  it('shows an empty state when nobody is enrolled', () => {
    wrap(<ClassStudentsPanel {...panel} students={[]} />);
    expect(screen.getByText('No students yet')).toBeInTheDocument();
  });

  it('change fee: needs a reason, then sends cents and the reason and refreshes', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json(enrollmentBody()));
    wrap(<ClassStudentsPanel {...panel} />);
    await user.click(screen.getByRole('button', { name: 'Change fee for Nimali Perera' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fee for Nimali Perera' });
    expect(within(dialog).getByText(/The class fee is LKR 2,500 a month/)).toBeInTheDocument();
    await expectNoAxeViolations(dialog);

    await user.type(within(dialog).getByLabelText('Monthly fee (LKR)'), '0');
    await user.click(within(dialog).getByRole('button', { name: 'Save fee' }));
    expect(await within(dialog).findByText('Give a reason for the fee.')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('Reason'), 'Teacher’s relative');
    await user.click(within(dialog).getByRole('button', { name: 'Save fee' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `/api/v1/admin/enrollments/${NIMALI.enrollmentId}`,
    );
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('PATCH');
    expect(bodyOf(fetch)).toEqual({ feeOverrideCents: 0, reason: 'Teacher’s relative' });
  });

  it('change fee: an existing override can go back to the class fee', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json(enrollmentBody({ id: SIBLING.enrollmentId })));
    wrap(<ClassStudentsPanel {...panel} />);
    await user.click(screen.getByRole('button', { name: 'Change fee for Tharindu Silva' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fee for Tharindu Silva' });
    expect(within(dialog).getByLabelText('Monthly fee (LKR)')).toHaveValue('1000');
    expect(within(dialog).getByLabelText('Reason')).toHaveValue('Sibling discount');
    await user.click(within(dialog).getByRole('button', { name: 'Use the class fee' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(bodyOf(fetch)).toEqual({ feeOverrideCents: null, reason: null });
  });

  it('move: picks the class and the month, then posts the move', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json(enrollmentBody({ id: ID(950), classId: ID(202) })));
    wrap(<ClassStudentsPanel {...panel} />);
    await user.click(screen.getByRole('button', { name: 'Move Nimali Perera to another class' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move Nimali Perera' });
    expect(within(dialog).getByRole('button', { name: 'Move student' })).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText('New class'), ID(202));
    await user.click(within(dialog).getByRole('button', { name: 'Move student' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `/api/v1/admin/enrollments/${NIMALI.enrollmentId}/move`,
    );
    expect(bodyOf(fetch)).toMatchObject({
      toClassId: ID(202),
      fromMonth: expect.stringMatching(/^\d{4}-\d{2}-01$/),
    });
  });

  it('move: says so when the student is already in the other class (409)', async () => {
    const user = userEvent.setup();
    stubFetch(() => problem(409, 'CONFLICT'));
    wrap(<ClassStudentsPanel {...panel} />);
    await user.click(screen.getByRole('button', { name: 'Move Nimali Perera to another class' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move Nimali Perera' });
    await user.selectOptions(within(dialog).getByLabelText('New class'), ID(202));
    await user.click(within(dialog).getByRole('button', { name: 'Move student' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'That student is already in the other class.',
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('end: sends the last month attended', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json(enrollmentBody({ toMonth: '2026-10-01' })));
    wrap(<ClassStudentsPanel {...panel} />);
    await user.click(screen.getByRole('button', { name: 'End enrolment of Nimali Perera' }));
    const dialog = await screen.findByRole('dialog', { name: "End Nimali Perera's enrolment" });
    await user.click(within(dialog).getByRole('button', { name: 'End enrolment' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(bodyOf(fetch)).toEqual({ toMonth: expect.stringMatching(/^\d{4}-\d{2}-01$/) });
  });

  it('add students: search, choose, override with a reason, and post', async () => {
    const user = userEvent.setup();
    const found = [
      {
        id: ID(301),
        studentNo: 'BR-1150',
        displayName: 'Fathima Rizna',
        phone: '+94768813302',
        school: null,
        alYear: null,
        status: 'active',
        classNames: [],
        activeDevices: 0,
        joinedAt: '2026-01-15T05:00:00.000Z',
      },
      {
        id: NIMALI.studentId,
        studentNo: NIMALI.studentNo,
        displayName: NIMALI.displayName,
        phone: NIMALI.phone,
        school: null,
        alYear: null,
        status: 'active',
        classNames: [aClass.name],
        activeDevices: 0,
        joinedAt: '2026-01-15T05:00:00.000Z',
      },
    ];
    const fetch = stubFetch((url) =>
      url.includes('/admin/students')
        ? json({ page: 1, pageSize: 25, total: 2, items: found })
        : json({ enrolled: 1, skipped: [] }, 201),
    );
    wrap(<ClassStudentsPanel {...panel} />);
    await user.click(screen.getByRole('button', { name: 'Add students' }));
    const dialog = await screen.findByRole('dialog', { name: `Add students to ${aClass.name}` });
    expect(within(dialog).getByRole('button', { name: 'Add students' })).toBeDisabled();

    await user.type(
      within(dialog).getByLabelText('Search by name, student number or phone'),
      'fat{Enter}',
    );
    const results = await within(dialog).findByRole('list', { name: 'Search results' });
    // A student already in the class is shown, ticked and disabled.
    expect(within(results).getByRole('checkbox', { name: 'Choose Nimali Perera' })).toBeDisabled();
    expect(within(results).getByText(/Already in this class/)).toBeInTheDocument();
    await user.click(within(results).getByRole('checkbox', { name: 'Choose Fathima Rizna' }));
    expect(within(dialog).getByText('1 student chosen')).toBeInTheDocument();
    await expectNoAxeViolations(dialog);

    await user.click(within(dialog).getByRole('checkbox', { name: 'Use a different monthly fee' }));
    await user.type(within(dialog).getByLabelText('Fee for these students (LKR)'), '1,500');
    await user.click(within(dialog).getByRole('button', { name: 'Add students' }));
    expect(await within(dialog).findByText('Give a reason for the fee.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Reason'), 'Scholarship');
    await user.click(within(dialog).getByRole('button', { name: 'Add students' }));

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    const enrolCall = fetch.mock.calls.find(([url]) => String(url).includes('/enrollments'));
    expect(String(enrolCall?.[0])).toBe(`/api/v1/admin/classes/${aClass.id}/enrollments`);
    expect(JSON.parse(String(enrolCall?.[1]?.body))).toEqual({
      studentIds: [ID(301)],
      fromMonth: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      feeOverrideCents: 150_000,
      reason: 'Scholarship',
    });
    expect((await screen.findAllByText('1 student added')).length).toBeGreaterThan(0);
  });

  it('add students: a failed search says so', async () => {
    const user = userEvent.setup();
    stubFetch(() => problem(500, 'INTERNAL'));
    wrap(<ClassStudentsPanel {...panel} />);
    await user.click(screen.getByRole('button', { name: 'Add students' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByLabelText('Search by name, student number or phone'),
      'x{Enter}',
    );
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "We couldn't search students",
    );
  });
});

describe('HallsPanel', () => {
  it('lists halls with seats, and adds one', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json({ id: ID(3), name: 'Hall C', capacity: 60 }, 201));
    const { container } = wrap(<HallsPanel halls={[HALL_A, HALL_B]} canWrite />);
    const table = screen.getByRole('table', { name: 'Halls' });
    expect(within(table).getByText('200 seats')).toBeInTheDocument();
    expect(within(table).getByText('Not set')).toBeInTheDocument();
    await expectNoAxeViolations(container);

    await user.click(screen.getByRole('button', { name: 'Add hall' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a hall' });
    await user.type(within(dialog).getByLabelText('Hall name'), 'Hall C');
    await user.type(within(dialog).getByLabelText(/^Seats/), '60');
    await user.click(within(dialog).getByRole('button', { name: 'Save hall' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(String(fetch.mock.calls[0]?.[0])).toBe('/api/v1/admin/halls');
    expect(bodyOf(fetch)).toEqual({ name: 'Hall C', capacity: 60 });
  });

  it('validates the name and the seats before sending; a duplicate name (409) shows on the field', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => problem(409, 'CONFLICT'));
    wrap(<HallsPanel halls={[HALL_A]} canWrite />);
    await user.click(screen.getByRole('button', { name: 'Add hall' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save hall' }));
    expect(await within(dialog).findByText(/Enter a name of up to 60/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Hall name'), 'Hall A');
    await user.type(within(dialog).getByLabelText(/^Seats/), '0');
    await user.click(within(dialog).getByRole('button', { name: 'Save hall' }));
    expect(await within(dialog).findByText(/whole number between 1 and 5,000/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    await user.clear(within(dialog).getByLabelText(/^Seats/));
    await user.click(within(dialog).getByRole('button', { name: 'Save hall' }));
    expect(
      await within(dialog).findByText('A hall with this name already exists.'),
    ).toBeInTheDocument();
  });

  it('edits a hall with a PUT', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json({ ...HALL_A, name: 'Main Hall' }));
    wrap(<HallsPanel halls={[HALL_A]} canWrite />);
    await user.click(screen.getByRole('button', { name: 'Edit Hall A' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit hall' });
    expect(within(dialog).getByLabelText('Hall name')).toHaveValue('Hall A');
    await user.clear(within(dialog).getByLabelText('Hall name'));
    await user.type(within(dialog).getByLabelText('Hall name'), 'Main Hall');
    await user.click(within(dialog).getByRole('button', { name: 'Save hall' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`/api/v1/admin/halls/${HALL_A.id}`);
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('PUT');
    expect(bodyOf(fetch)).toEqual({ name: 'Main Hall', capacity: 200 });
  });

  it('delete asks first; a hall that a class uses (409) is explained, not deleted', async () => {
    const user = userEvent.setup();
    stubFetch(() => problem(409, 'CONFLICT'));
    wrap(<HallsPanel halls={[HALL_A]} canWrite />);
    await user.click(screen.getByRole('button', { name: 'Delete Hall A' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete hall' }));
    expect((await screen.findAllByText(/Hall A is still used by a class/)).length).toBeGreaterThan(
      0,
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('delete: removes a free hall and refreshes', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json(null, 204));
    wrap(<HallsPanel halls={[HALL_B]} canWrite />);
    await user.click(screen.getByRole('button', { name: 'Delete Hall B' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete hall' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('read-only: no buttons, an explanation instead', () => {
    wrap(<HallsPanel halls={[HALL_A]} canWrite={false} />);
    expect(screen.queryByRole('button', { name: 'Add hall' })).not.toBeInTheDocument();
    expect(screen.getByText('Only owners and admins can change halls.')).toBeInTheDocument();
  });

  it('empty state when there are no halls', () => {
    wrap(<HallsPanel halls={[]} canWrite />);
    expect(screen.getAllByText('No halls yet').length).toBeGreaterThan(0);
    expect(screen.getByText(/Add the rooms you teach in/)).toBeInTheDocument();
  });
});

describe('ThemeForm', () => {
  const initial: Theme = { brandColor: '#0f766e', logoUrl: null, faviconUrl: null };

  it('gives live contrast feedback in words and blocks a colour that is too light', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json(initial));
    const { container } = wrap(<ThemeForm initial={initial} />);
    const status = screen.getByRole('status', { name: 'Readability' });
    expect(status).toHaveTextContent(
      /Readable: white text on this colour has a contrast of 5\.\d to 1/,
    );
    await expectNoAxeViolations(container);

    const field = screen.getByLabelText('Colour code');
    await user.clear(field);
    await user.type(field, '#ffcc00');
    expect(status).toHaveTextContent(/Too light:.*needs at least 4\.5 to 1/);
    expect(screen.getByRole('button', { name: 'Save theme' })).toBeDisabled();

    await user.clear(field);
    await user.type(field, 'banana');
    expect(status).toHaveTextContent(/Enter a colour as #/);
    expect(screen.getByRole('button', { name: 'Save theme' })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('saves the colour in lower case with the logo and favicon addresses, then refreshes the shell', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json(initial));
    wrap(<ThemeForm initial={{ brandColor: null, logoUrl: null, faviconUrl: null }} />);
    expect(screen.getByRole('status', { name: 'Readability' })).toHaveTextContent(
      'Using the ReMix blue.',
    );
    await user.type(screen.getByLabelText('Colour code'), '#1D4ED8');
    await user.type(screen.getByLabelText('Logo address'), 'https://cdn.example.test/logo.png');
    await user.type(screen.getByLabelText('Tab icon address'), 'https://cdn.example.test/icon.ico');
    expect(screen.getByRole('img', { name: 'Your logo' })).toHaveAttribute(
      'src',
      'https://cdn.example.test/logo.png',
    );
    await user.click(screen.getByRole('button', { name: 'Save theme' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(String(fetch.mock.calls[0]?.[0])).toBe('/api/v1/admin/settings/theme');
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('PATCH');
    expect(bodyOf(fetch)).toEqual({
      brandColor: '#1d4ed8',
      logoUrl: 'https://cdn.example.test/logo.png',
      faviconUrl: 'https://cdn.example.test/icon.ico',
    });
  });

  it('refuses http addresses and clears to the default colour with null', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json(initial));
    wrap(<ThemeForm initial={initial} />);
    await user.type(screen.getByLabelText('Logo address'), 'http://cdn.example.test/logo.png');
    expect(
      screen.getAllByText('Enter an address that starts with https://').length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Save theme' })).toBeDisabled();
    await user.clear(screen.getByLabelText('Logo address'));

    await user.click(screen.getByRole('button', { name: 'Use the ReMix blue' }));
    await user.click(screen.getByRole('button', { name: 'Save theme' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(bodyOf(fetch)).toEqual({ brandColor: null, logoUrl: null, faviconUrl: null });
  });

  it('shows the API’s refusal', async () => {
    const user = userEvent.setup();
    stubFetch(() => problem(403, 'FORBIDDEN'));
    wrap(<ThemeForm initial={initial} />);
    await user.click(screen.getByRole('button', { name: 'Save theme' }));
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('alert')
          .map((a) => a.textContent)
          .join(' '),
      ).toMatch(/isn't allowed to do this/),
    );
  });
});

describe('GeneralForm', () => {
  it('saves the name and the default language', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json({ name: 'KP Academy', defaultLocale: 'si' }));
    const { container } = wrap(
      <GeneralForm initial={{ name: 'Kamal Physics', defaultLocale: 'en' }} />,
    );
    await expectNoAxeViolations(container);
    await user.clear(screen.getByLabelText('Institute name'));
    await user.type(screen.getByLabelText('Institute name'), '  KP Academy ');
    await user.selectOptions(screen.getByLabelText('Default language'), 'si');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(String(fetch.mock.calls[0]?.[0])).toBe('/api/v1/admin/settings/general');
    expect(bodyOf(fetch)).toEqual({ name: 'KP Academy', defaultLocale: 'si' });
  });

  it('rejects a name that is too short before sending', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json({}));
    wrap(<GeneralForm initial={{ name: 'Kamal Physics', defaultLocale: 'en' }} />);
    await user.clear(screen.getByLabelText('Institute name'));
    await user.type(screen.getByLabelText('Institute name'), 'K');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter a name of 2 to 120 characters.')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
