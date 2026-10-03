// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StaffResponse, StudentListItem, StudentProfile } from '@remix/types/api';
import { ToastProvider } from '@remix/ui';
import common from '../../../messages/en/common.json';
import errors from '../../../messages/en/errors.json';
import staff from '../../../messages/en/staff.json';
import students from '../../../messages/en/students.json';
import { StaffPanel } from '../staff/staff-panel';
import { DevicesPanel } from '../students/devices-panel';
import { StudentForm } from '../students/student-form';
import { StudentsTable } from '../students/students-table';
import { StudentsToolbar } from '../students/students-toolbar';

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
      messages={{ common, errors, students, staff }}
    >
      <ToastProvider dismissLabel="Dismiss" regionLabel="Notifications">
        {ui}
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

async function expectNoAxeViolations(container: Element) {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
    resultTypes: ['violations'],
  });
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

function stubFetch(respond: (url: string, init: RequestInit) => Response) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) =>
    respond(String(input), init ?? {}),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const A = '0193f1c2-7b1d-7c3e-9a4f-00000000000a';
const B = '0193f1c2-7b1d-7c3e-9a4f-00000000000b';
const CLASS = '0193f1c2-7b1d-7c3e-9a4f-0000000000c1';
const classes = [{ id: CLASS, name: '2027 A/L Physics Theory' }];

const item = (id: string, name: string, over: Partial<StudentListItem> = {}): StudentListItem => ({
  id,
  studentNo: `BR-${id.slice(-4)}`,
  displayName: name,
  phone: '+94771234567',
  school: null,
  alYear: 2027,
  status: 'active',
  classNames: ['2027 A/L Physics Theory'],
  activeDevices: 1,
  joinedAt: '2026-01-15T05:00:00.000Z',
  ...over,
});
const rows = [
  item(A, 'Nimali Perera'),
  item(B, 'Kasun Silva', { status: 'invited', classNames: [] }),
];

const tableProps = {
  items: rows,
  classes,
  canWrite: true,
  canDevices: true,
  archivedView: false,
  filtered: false,
  clearHref: '/admin/students',
};

describe('StudentsTable', () => {
  it('shows status as a word, phones the local way and devices out of 2', async () => {
    const { container } = wrap(<StudentsTable {...tableProps} />);
    const table = screen.getByRole('table', { name: 'Students' });
    expect(within(table).getByText('Active')).toBeInTheDocument();
    expect(within(table).getByText('Invited')).toBeInTheDocument();
    expect(within(table).getAllByText('077 123 4567')).toHaveLength(2);
    expect(within(table).getAllByText('1 of 2')).toHaveLength(2);
    await expectNoAxeViolations(container);
  });

  it('hides checkboxes and bulk actions without write permission', () => {
    wrap(<StudentsTable {...tableProps} canWrite={false} canDevices={false} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('selecting rows opens the bulk bar; archive confirms, calls the API and refreshes', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json({ affected: 2, skipped: [] }));
    const { container } = wrap(<StudentsTable {...tableProps} />);

    await user.click(screen.getByRole('checkbox', { name: 'Select all students on this page' }));
    const bar = screen.getByRole('region', { name: 'Actions for the selected students' });
    expect(within(bar).getByText('2 students selected')).toBeInTheDocument();
    await expectNoAxeViolations(container);

    await user.click(within(bar).getByRole('button', { name: 'Archive' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe('/api/v1/admin/students/bulk');
    expect(JSON.parse(String(init?.body))).toEqual({ action: 'archive', studentIds: [A, B] });
    expect((await screen.findAllByText('2 students archived')).length).toBeGreaterThan(0);
  });

  it('only offers sign-out when the role may manage devices, and Reactivate in the archived view', async () => {
    const user = userEvent.setup();
    const { rerender } = wrap(<StudentsTable {...tableProps} canDevices={false} />);
    await user.click(screen.getByRole('checkbox', { name: 'Select Nimali Perera' }));
    expect(screen.queryByRole('button', { name: 'Sign out devices' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    rerender(
      <NextIntlClientProvider locale="en" messages={{ common, errors, students, staff }}>
        <ToastProvider dismissLabel="Dismiss" regionLabel="Notifications">
          <StudentsTable {...tableProps} archivedView />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('shows a danger toast with a readable message when the API refuses', async () => {
    const user = userEvent.setup();
    stubFetch(() =>
      json({ type: 'about:blank', title: 'Not allowed', status: 403, code: 'FORBIDDEN' }, 403),
    );
    wrap(<StudentsTable {...tableProps} />);
    await user.click(screen.getByRole('checkbox', { name: 'Select Nimali Perera' }));
    await user.click(screen.getByRole('button', { name: 'Sign out devices' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Sign out' }),
    );
    expect((await screen.findAllByText(/Your role isn't allowed/)).length).toBeGreaterThan(0);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('shows the empty states', () => {
    const { rerender } = wrap(<StudentsTable {...tableProps} items={[]} />);
    expect(screen.getByText('No students yet')).toBeInTheDocument();
    rerender(
      <NextIntlClientProvider locale="en" messages={{ common, errors, students, staff }}>
        <ToastProvider dismissLabel="Dismiss" regionLabel="Notifications">
          <StudentsTable {...tableProps} items={[]} filtered />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('No students match')).toBeInTheDocument();
  });
});

describe('StudentsToolbar', () => {
  const query = { page: 1, pageSize: 25, sort: 'name' } as const;

  it('puts the filters in the URL', async () => {
    const user = userEvent.setup();
    const { container } = wrap(<StudentsToolbar query={query} classes={classes} />);
    await user.type(
      screen.getByRole('searchbox', { name: 'Name, number or phone' }),
      'nimali{Enter}',
    );
    expect(router.push).toHaveBeenLastCalledWith('/admin/students?q=nimali');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'invited');
    expect(router.push).toHaveBeenLastCalledWith('/admin/students?q=nimali&status=invited');
    await expectNoAxeViolations(container);
  });

  it('offers no class filter when there are no classes, and Clear only when filtering', () => {
    const { rerender } = wrap(<StudentsToolbar query={query} classes={[]} />);
    expect(screen.queryByRole('combobox', { name: 'Class' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Clear filters' })).not.toBeInTheDocument();
    rerender(
      <NextIntlClientProvider locale="en" messages={{ common, errors, students, staff }}>
        <ToastProvider dismissLabel="Dismiss" regionLabel="Notifications">
          <StudentsToolbar query={{ ...query, q: 'x' }} classes={[]} />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('link', { name: 'Clear filters' })).toHaveAttribute(
      'href',
      '/admin/students',
    );
  });
});

const profile = (devices: StudentProfile['devices']): StudentProfile => ({
  ...rows[0]!,
  medium: null,
  under18: false,
  consent: null,
  guardians: [],
  enrollments: [],
  devices,
  overview: {
    owesCents: null,
    paidThisYearCents: null,
    attendancePercent: null,
    lessonsWatched: null,
  },
  archivedAt: null,
});

describe('DevicesPanel', () => {
  const devices = [
    {
      id: '0193f1c2-7b1d-7c3e-9a4f-0000000000d1',
      label: 'iPhone 12 · Safari',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-10-01T03:00:00.000Z',
    },
    {
      id: '0193f1c2-7b1d-7c3e-9a4f-0000000000d2',
      label: 'HP Laptop · Chrome',
      firstSeenAt: '2026-02-01T00:00:00.000Z',
      lastSeenAt: '2026-09-30T03:00:00.000Z',
    },
  ];

  it('lists devices out of the 2-device limit and has no axe violations', async () => {
    const { container } = wrap(
      <DevicesPanel studentId={A} name="Nimali Perera" devices={devices} />,
    );
    expect(screen.getByRole('heading', { name: 'Signed-in devices · 2 of 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out iPhone 12 · Safari' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('signs one device out through the typed client (DELETE with both ids in the path)', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json(null, 204));
    wrap(<DevicesPanel studentId={A} name="Nimali Perera" devices={devices} />);
    await user.click(screen.getByRole('button', { name: 'Sign out HP Laptop · Chrome' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Sign out' }),
    );
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe(`/api/v1/admin/students/${A}/devices/${devices[1]?.id}`);
    expect(init?.method).toBe('DELETE');
  });

  it('resets the password with POST and tells who got the code', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json(null, 204));
    wrap(<DevicesPanel studentId={A} name="Nimali Perera" devices={[]} />);
    expect(screen.getByText('Not signed in anywhere')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out all' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Reset and text a code',
      }),
    );
    expect(
      (await screen.findAllByText('We texted Nimali Perera a code to set a new password')).length,
    ).toBeGreaterThan(0);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`/api/v1/admin/students/${A}/password-reset`);
  });
});

describe('StudentForm', () => {
  it('has no axe violations and shows consent fields only for under-18s', async () => {
    const user = userEvent.setup();
    const { container } = wrap(<StudentForm mode="create" classes={classes} />);
    expect(screen.queryByLabelText('Consent given by')).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /under 18/ }));
    expect(screen.getByLabelText('Consent given by')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('validates with the API schema before sending', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json({}));
    wrap(<StudentForm mode="create" classes={classes} />);
    await user.click(screen.getByRole('button', { name: 'Add student' }));
    expect(await screen.findByText("Enter the student's name.")).toBeInTheDocument();
    expect(screen.getByText(/Enter a Sri Lankan mobile number/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('limits guardians to three', async () => {
    const user = userEvent.setup();
    wrap(<StudentForm mode="create" classes={[]} />);
    for (let i = 0; i < 3; i++) {
      await user.click(screen.getByRole('button', { name: 'Add a parent or guardian' }));
    }
    expect(screen.getAllByText(/^Guardian \d$/)).toHaveLength(3);
    expect(
      screen.queryByRole('button', { name: 'Add a parent or guardian' }),
    ).not.toBeInTheDocument();
  });

  it('creates the student, sending a normalised body, and opens the profile', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json(profile([])));
    wrap(<StudentForm mode="create" classes={classes} />);
    await user.type(screen.getByLabelText('Full name'), 'Nimali Perera');
    await user.type(screen.getByLabelText('Phone number'), '077 123 4567');
    await user.click(screen.getByRole('checkbox', { name: '2027 A/L Physics Theory' }));
    await user.click(screen.getByRole('button', { name: 'Add student' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/admin/students/${A}`));
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      displayName: 'Nimali Perera',
      phone: '+94771234567',
      classIds: [CLASS],
      sendWelcomeSms: true,
    });
  });

  it('shows a duplicate phone (409) next to the phone field', async () => {
    const user = userEvent.setup();
    stubFetch(() =>
      json({ type: 'about:blank', title: 'Conflict', status: 409, code: 'CONFLICT' }, 409),
    );
    wrap(<StudentForm mode="create" classes={[]} />);
    await user.type(screen.getByLabelText('Full name'), 'Nimali Perera');
    await user.type(screen.getByLabelText('Phone number'), '077 123 4567');
    await user.click(screen.getByRole('button', { name: 'Add student' }));
    expect(
      await screen.findByText('Someone at your institute already uses this phone number.'),
    ).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });
});

const staffData: StaffResponse = {
  items: [
    {
      id: A,
      displayName: 'Kamal Jayasinghe',
      phone: '+94711111111',
      email: null,
      roles: ['owner'],
      classScope: [],
      status: 'active',
      inviteExpiresAt: null,
      lastSignInAt: '2026-10-01T03:00:00.000Z',
    },
    {
      id: B,
      displayName: 'Dilani Fernando',
      phone: '+94712345678',
      email: null,
      roles: ['cashier'],
      classScope: [],
      status: 'active',
      inviteExpiresAt: null,
      lastSignInAt: null,
    },
    {
      id: CLASS,
      displayName: 'Anura Kumara',
      phone: '+94770000000',
      email: null,
      roles: ['teacher'],
      classScope: [],
      status: 'invited',
      inviteExpiresAt: '2026-10-18T03:00:00.000Z',
      lastSignInAt: null,
    },
  ],
  usage: { teachers: { used: 1, limit: 1 }, cashiers: { used: 1, limit: 3 } },
};

describe('StaffPanel', () => {
  it('shows roles, status words, 2-step status and seat usage; no actions on your own row', async () => {
    const { container } = wrap(<StaffPanel data={staffData} classes={classes} currentUserId={A} />);
    expect(screen.getByText('1 of 1')).toBeInTheDocument();
    expect(screen.getByText('All seats are in use')).toBeInTheDocument();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('Active')).toHaveLength(2);
    expect(within(table).getByText('Invited')).toBeInTheDocument();
    expect(within(table).getAllByText('Required')).toHaveLength(2);
    expect(within(table).getByText('Not needed')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Disable Kamal Jayasinghe' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable Dilani Fernando' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Revoke the invitation for Anura Kumara' }),
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('revokes an invitation after confirming', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json(null, 204));
    wrap(<StaffPanel data={staffData} classes={classes} currentUserId={A} />);
    await user.click(
      screen.getByRole('button', { name: 'Revoke the invitation for Anura Kumara' }),
    );
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Revoke invitation',
      }),
    );
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`/api/v1/admin/staff/invites/${CLASS}`);
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('disables a member with PATCH status', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() => json({ ...staffData.items[1], status: 'disabled' }));
    wrap(<StaffPanel data={staffData} classes={classes} currentUserId={A} />);
    await user.click(screen.getByRole('button', { name: 'Disable Dilani Fernando' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Disable' }),
    );
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ status: 'disabled' });
  });

  it('invites someone: needs a phone for SMS roles, shows plan-limit errors', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch(() =>
      json({ type: 'about:blank', title: 'Plan', status: 403, code: 'PLAN_LIMIT' }, 403),
    );
    wrap(<StaffPanel data={staffData} classes={classes} currentUserId={A} />);
    await user.click(screen.getByRole('button', { name: 'Invite someone' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Full name'), 'New Cashier');
    await user.selectOptions(within(dialog).getByLabelText('Role'), 'cashier');
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(
      await within(dialog).findByText('A phone number is needed for this role.'),
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('Phone number'), '077 765 4321');
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(await within(dialog).findByText(/no free seat for this role/)).toBeInTheDocument();
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      displayName: 'New Cashier',
      phone: '+94777654321',
      role: 'cashier',
    });
  });
});
