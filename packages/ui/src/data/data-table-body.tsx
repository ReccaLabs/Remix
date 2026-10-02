'use client';

import type { FocusEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { isFromControl } from './row-events';

function rowsOf(tbody: HTMLElement) {
  return Array.from(tbody.querySelectorAll<HTMLTableRowElement>(':scope > tr[data-row]'));
}

/** Roving tabindex: only the focused row is in the tab order. */
function focusRow(tbody: HTMLElement, row: HTMLTableRowElement | undefined) {
  if (!row) return;
  for (const r of rowsOf(tbody)) r.tabIndex = r === row ? 0 : -1;
  row.focus();
}

/**
 * Client island for <DataTable> rows that open something. The rows themselves are rendered on
 * the server and passed as children; this only adds event delegation:
 *
 * - ↑/↓ move between rows, Home/End jump to the first/last row (one Tab stop for the table).
 * - Enter (or a click anywhere on the row) follows the row's link (`[data-row-link]`).
 * - Clicks on real controls inside a row (checkbox, button, link) behave normally.
 */
export function InteractiveTableBody({ children }: { children: ReactNode }) {
  function onKeyDown(e: KeyboardEvent<HTMLTableSectionElement>) {
    const row = e.target as HTMLElement;
    if (!(row instanceof HTMLTableRowElement) || !row.hasAttribute('data-row')) return;
    const rows = rowsOf(e.currentTarget);
    const index = rows.indexOf(row);
    let next: HTMLTableRowElement | undefined;
    switch (e.key) {
      case 'ArrowDown':
        next = rows[Math.min(index + 1, rows.length - 1)];
        break;
      case 'ArrowUp':
        next = rows[Math.max(index - 1, 0)];
        break;
      case 'Home':
        next = rows[0];
        break;
      case 'End':
        next = rows[rows.length - 1];
        break;
      case 'Enter':
        e.preventDefault();
        row.click();
        return;
      default:
        return;
    }
    e.preventDefault();
    focusRow(e.currentTarget, next);
  }

  function onClick(e: MouseEvent<HTMLTableSectionElement>) {
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLTableRowElement>('tr[data-row]');
    if (!row || !e.currentTarget.contains(row)) return;
    // Let real controls do their own thing.
    if (isFromControl(target, row)) return;
    // Don't hijack text selection.
    if (window.getSelection?.()?.toString()) return;
    row.querySelector<HTMLElement>('[data-row-link]')?.click();
  }

  function onFocus(e: FocusEvent<HTMLTableSectionElement>) {
    const row = e.target;
    if (row instanceof HTMLTableRowElement && row.hasAttribute('data-row') && row.tabIndex !== 0) {
      for (const r of rowsOf(e.currentTarget)) r.tabIndex = r === row ? 0 : -1;
    }
  }

  return (
    // Event delegation only: the focusable rows are the interactive elements.
    <tbody onKeyDown={onKeyDown} onClick={onClick} onFocus={onFocus}>
      {children}
    </tbody>
  );
}
