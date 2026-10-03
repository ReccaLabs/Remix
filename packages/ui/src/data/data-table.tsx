import { useId, type ReactNode } from 'react';
import { cn } from '../cn';
import { Skeleton } from '../feedback/skeleton';
import type { LinkComponent } from '../link';
import { InteractiveTableBody } from './data-table-body';
import { isFromControl } from './row-events';

export interface DataTableColumn<T> {
  /** Stable key for the column. */
  id: string;
  /** Header text (localised). Always given, even when visually hidden. */
  header: ReactNode;
  /** Renders the cell for a row. */
  cell: (row: T, index: number) => ReactNode;
  /** `end` for money and counts (also turns on tabular figures). */
  align?: 'start' | 'end';
  /**
   * The column that names the row ("Name"): rendered as `<th scope="row">`, and the cell that
   * carries the row link when `rowHref` is set. Use on exactly one column.
   */
  rowHeader?: boolean;
  /** Keep the header for screen readers but hide it visually (e.g. a checkbox column). */
  hideHeader?: boolean;
  /** Let long text wrap instead of scrolling sideways. */
  wrap?: boolean;
  className?: string;
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Table name for screen readers ("Students"). Also labels the scroll region. */
  caption: ReactNode;
  /** Show the caption visually (usually the card heading already says it). */
  captionVisible?: boolean;
  /** Shows skeleton rows and marks the table busy. */
  loading?: boolean;
  /** Spoken while loading ("Loading students…"). */
  loadingLabel?: string;
  /** Number of skeleton rows. */
  skeletonRows?: number;
  /** Shown in place of rows when there are none — usually an <EmptyState size="compact">. */
  empty?: ReactNode;
  /** Makes rows open a page: whole-row click, Enter, and ↑/↓ between rows. */
  rowHref?: (row: T) => string;
  /** Router link for `rowHref` (Next.js `Link`). Defaults to `<a>`. */
  linkComponent?: LinkComponent;
  /** Client-side alternative to `rowHref` (only from a client component). */
  onRowActivate?: (row: T) => void;
  /** Extra classes per row, e.g. highlight the class in progress. */
  rowClassName?: (row: T) => string | undefined;
  /**
   * Keeps the header row visible while the rows scroll (long lists): the table body scrolls
   * inside a region of at most 70 vh.
   */
  stickyHeader?: boolean;
  className?: string;
}

/**
 * DataTable v1: a real <table> with caption, header scopes and row headers.
 *
 * - Phones: scrolls sideways inside a focusable, labelled region (cells don't wrap by default).
 * - `loading`: skeleton rows + `aria-busy`; `empty`: one full-width cell.
 * - Clickable rows (`rowHref`/`onRowActivate`) get a single Tab stop with arrow-key movement.
 *
 * Server-compatible: column `cell` functions run where the table is rendered; only the row
 * keyboard handling ships as a small client island.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  captionVisible = false,
  loading = false,
  loadingLabel,
  skeletonRows = 5,
  empty,
  rowHref,
  linkComponent: Link = 'a',
  onRowActivate,
  rowClassName,
  stickyHeader = false,
  className,
}: DataTableProps<T>) {
  const captionId = `table-caption-${useId()}`;
  const interactive = !loading && rows.length > 0 && Boolean(rowHref || onRowActivate);
  const linkColumn = columns.find((c) => c.rowHeader) ?? columns[0];

  const cellPad = 'px-3 first:pl-4 last:pr-4 lg:first:pl-[18px] lg:last:pr-[18px]';

  const body = loading ? (
    Array.from({ length: skeletonRows }, (_, i) => (
      <tr key={`skeleton-${i}`} className="border-line-soft border-b last:border-b-0">
        {columns.map((col) => (
          <td key={col.id} className={cn('py-3', cellPad)}>
            <Skeleton
              shape="text"
              className={cn('h-4', col.align === 'end' ? 'ml-auto w-12' : 'w-[70%] max-w-40')}
            />
          </td>
        ))}
      </tr>
    ))
  ) : rows.length === 0 ? (
    <tr>
      <td colSpan={columns.length} className="p-0">
        {empty}
      </td>
    </tr>
  ) : (
    rows.map((row, index) => {
      const href = rowHref?.(row);
      return (
        <tr
          key={rowKey(row)}
          data-row={interactive ? '' : undefined}
          tabIndex={interactive ? (index === 0 ? 0 : -1) : undefined}
          onClick={
            onRowActivate
              ? (e) => {
                  if (!isFromControl(e.target, e.currentTarget)) onRowActivate(row);
                }
              : undefined
          }
          className={cn(
            'border-line-soft border-b last:border-b-0',
            interactive &&
              'hover:bg-canvas focus-visible:bg-brand-soft focus-visible:outline-brand cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2',
            rowClassName?.(row),
          )}
        >
          {columns.map((col) => {
            const content = col.cell(row, index);
            const Cell = col.rowHeader ? 'th' : 'td';
            return (
              <Cell
                key={col.id}
                scope={col.rowHeader ? 'row' : undefined}
                className={cn(
                  'py-3 text-left align-middle',
                  cellPad,
                  col.rowHeader && 'font-medium',
                  col.align === 'end' && 'tabular text-right',
                  !col.wrap && 'whitespace-nowrap',
                  col.className,
                )}
              >
                {href && col === linkColumn ? (
                  <Link
                    href={href}
                    data-row-link=""
                    tabIndex={interactive ? -1 : undefined}
                    className="text-ink hover:text-brand underline-offset-2 hover:underline"
                  >
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </Cell>
            );
          })}
        </tr>
      );
    })
  );

  return (
    <div className={cn('relative', className)}>
      {/* Keyboard users can scroll the table sideways once it has focus (WCAG 2.1.1). */}
      <div
        role="region"
        aria-labelledby={captionId}
        tabIndex={0}
        className={cn(
          'focus-visible:outline-brand overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2',
          stickyHeader && 'max-h-[70vh] overflow-y-auto',
        )}
      >
        <table
          aria-busy={loading || undefined}
          className="tabular w-full border-collapse text-left text-sm"
        >
          <caption
            id={captionId}
            className={cn(
              captionVisible
                ? 'text-ink px-4 py-3 text-left text-[15px] font-semibold lg:px-[18px]'
                : 'sr-only',
            )}
          >
            {caption}
          </caption>
          <thead>
            <tr className="border-line border-b">
              {columns.map((col) => (
                <th
                  key={col.id}
                  scope="col"
                  className={cn(
                    'text-muted whitespace-nowrap py-2.5 text-xs font-medium',
                    stickyHeader &&
                      'bg-surface sticky top-0 z-10 shadow-[inset_0_-1px_0_var(--color-line)]',
                    cellPad,
                    col.align === 'end' ? 'text-right' : 'text-left',
                    col.headerClassName,
                  )}
                >
                  {col.hideHeader ? <span className="sr-only">{col.header}</span> : col.header}
                </th>
              ))}
            </tr>
          </thead>
          {interactive ? (
            <InteractiveTableBody>{body}</InteractiveTableBody>
          ) : (
            <tbody>{body}</tbody>
          )}
        </table>
      </div>
      <p role="status" className="sr-only">
        {loading ? loadingLabel : null}
      </p>
    </div>
  );
}
