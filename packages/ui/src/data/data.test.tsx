import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from '../feedback/empty-state';
import { StatusBadge } from '../feedback/status-badge';
import type { LinkLikeProps } from '../link';
import { expectNoAxeViolations } from '../test/axe';
import { DataTable, type DataTableColumn } from './data-table';
import { StatCard } from './stat-card';

interface Student {
  id: string;
  name: string;
  number: string;
  classes: number;
  paid: boolean;
}

const students: Student[] = [
  { id: 's1', name: 'Sample Student A', number: 'BR-0001', classes: 3, paid: false },
  { id: 's2', name: 'Sample Student B', number: 'BR-0002', classes: 2, paid: true },
  { id: 's3', name: 'Sample Student C', number: 'BR-0003', classes: 1, paid: true },
];

const columns: DataTableColumn<Student>[] = [
  { id: 'name', header: 'Name', cell: (s) => s.name, rowHeader: true },
  { id: 'number', header: 'Student no.', cell: (s) => s.number },
  { id: 'classes', header: 'Classes', cell: (s) => s.classes, align: 'end' },
  {
    id: 'fee',
    header: 'Oct fee',
    cell: (s) =>
      s.paid ? (
        <StatusBadge tone="success">Paid</StatusBadge>
      ) : (
        <StatusBadge tone="danger">Unpaid</StatusBadge>
      ),
  },
];

function table(extra: Partial<Parameters<typeof DataTable<Student>>[0]> = {}) {
  return (
    <DataTable
      caption="Students"
      columns={columns}
      rows={students}
      rowKey={(s) => s.id}
      {...extra}
    />
  );
}

describe('DataTable', () => {
  it('renders a captioned table with column and row headers', () => {
    render(table());
    const t = screen.getByRole('table', { name: 'Students' });
    const headers = within(t).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual([
      'Name',
      'Student no.',
      'Classes',
      'Oct fee',
    ]);
    expect(headers[0]).toHaveAttribute('scope', 'col');
    expect(within(t).getByRole('rowheader', { name: 'Sample Student A' })).toHaveAttribute(
      'scope',
      'row',
    );
    // 1 header row + 3 body rows.
    expect(within(t).getAllByRole('row')).toHaveLength(4);
    expect(within(t).getByText('Unpaid')).toBeInTheDocument();
  });

  it('scrolls sideways inside a focusable, labelled region', () => {
    render(table());
    const region = screen.getByRole('region', { name: 'Students' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region.className).toContain('overflow-x-auto');
  });

  it('shows the empty state in one full-width cell', () => {
    render(
      table({
        rows: [],
        empty: <EmptyState title="No students yet" headingLevel={3} size="compact" />,
      }),
    );
    const cell = screen.getByRole('cell');
    expect(cell).toHaveAttribute('colspan', '4');
    expect(within(cell).getByRole('heading', { name: 'No students yet' })).toBeInTheDocument();
  });

  it('shows skeleton rows, marks the table busy and announces loading', () => {
    render(table({ loading: true, loadingLabel: 'Loading students…', skeletonRows: 4 }));
    const t = screen.getByRole('table', { name: 'Students' });
    expect(t).toHaveAttribute('aria-busy', 'true');
    expect(within(t).getAllByRole('row')).toHaveLength(5);
    expect(within(t).queryByText('Sample Student A')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Loading students…');
  });

  it('plain rows are not focusable', () => {
    render(table());
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    for (const r of rows) expect(r).not.toHaveAttribute('tabindex');
  });

  it('linked rows: one tab stop, arrow keys move, Enter follows the router link', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    function RouterLink({ href, children, ...rest }: LinkLikeProps & { children?: ReactNode }) {
      return (
        <a
          href={href}
          {...rest}
          onClick={(e) => {
            e.preventDefault();
            navigate(href);
          }}
        >
          {children}
        </a>
      );
    }
    render(table({ rowHref: (s) => `/admin/students/${s.id}`, linkComponent: RouterLink }));
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);

    await user.tab(); // scroll region
    await user.tab(); // first row
    expect(rows[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(rows[1]).toHaveFocus();
    expect(rows.map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    await user.keyboard('{End}');
    expect(rows[2]).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(rows[1]).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledWith('/admin/students/s2');

    // Clicking anywhere on the row follows the link too.
    await user.click(within(rows[2] as HTMLElement).getByText('BR-0003'));
    expect(navigate).toHaveBeenLastCalledWith('/admin/students/s3');

    // The row link itself is reachable by screen readers but not an extra Tab stop.
    const link = within(rows[0] as HTMLElement).getByRole('link', { name: 'Sample Student A' });
    expect(link).toHaveAttribute('tabindex', '-1');
  });

  it('onRowActivate fires once per Enter or click, but not for controls inside the row', async () => {
    const user = userEvent.setup();
    const onRowActivate = vi.fn();
    const withCheckbox: DataTableColumn<Student>[] = [
      {
        id: 'select',
        header: 'Select',
        hideHeader: true,
        cell: (s) => <input type="checkbox" aria-label={`Select ${s.name}`} />,
      },
      ...columns,
    ];
    render(table({ columns: withCheckbox, onRowActivate }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Sample Student A' }));
    expect(onRowActivate).not.toHaveBeenCalled();

    await user.click(screen.getByText('BR-0002'));
    expect(onRowActivate).toHaveBeenCalledTimes(1);
    expect(onRowActivate).toHaveBeenLastCalledWith(students[1]);

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    (rows[0] as HTMLElement).focus();
    await user.keyboard('{Enter}');
    expect(onRowActivate).toHaveBeenCalledTimes(2);
    expect(onRowActivate).toHaveBeenLastCalledWith(students[0]);
  });

  it('has no axe violations: rows, linked rows, empty and loading', async () => {
    const { container } = render(
      <>
        {table()}
        {table({ caption: 'Linked students', rowHref: (s) => `/s/${s.id}` })}
        {table({
          caption: 'No students',
          rows: [],
          empty: <EmptyState title="None" headingLevel={3} />,
        })}
        {table({ caption: 'Loading', loading: true, loadingLabel: 'Loading…' })}
      </>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('StatCard', () => {
  it('shows label, value, context and an accessible progress bar', async () => {
    const { container } = render(
      <StatCard
        label="Fees collected · Sample month"
        value="LKR 1,000"
        context="of 2,000"
        progress={{ value: 50, label: 'Fees collected' }}
        detail={{ text: '1 fee still to collect', tone: 'danger', icon: <CircleAlert /> }}
        action={<a href="/fees">View list</a>}
      />,
    );
    expect(screen.getByText('LKR 1,000')).toBeInTheDocument();
    expect(screen.getByText('of 2,000')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Fees collected' });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveAttribute('aria-valuetext', '50%');
    expect(screen.getByText('1 fee still to collect')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View list' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('clamps progress and supports a custom max', () => {
    render(
      <StatCard
        label="Present"
        value="412"
        progress={{ value: 600, max: 468, label: 'Present' }}
      />,
    );
    expect(screen.getByRole('progressbar', { name: 'Present' })).toHaveAttribute(
      'aria-valuetext',
      '100%',
    );
  });
});
