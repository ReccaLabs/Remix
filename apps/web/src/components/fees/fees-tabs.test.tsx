// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { allowedFeesTabs, resolveFeesTab } from '@/lib/fees-tabs';
import { FeesTabs, type FeesTab } from './fees-tabs';

afterEach(cleanup);

const SLIPS: FeesTab = { id: 'slips', href: '/admin/fees?tab=slips', label: 'Bank slips', active: true, count: 3, countLabel: 'slips waiting' };
const TABS: FeesTab[] = [
  { id: 'payments', href: '/admin/fees', label: 'Payments', active: false },
  { id: 'invoices', href: '/admin/fees?tab=invoices', label: 'Invoices', active: false },
  SLIPS,
  { id: 'cash', href: '/admin/fees?tab=cash', label: 'Cash counter', active: false },
];

describe('Fees tab bar', () => {
  it('marks the current tab, speaks the waiting count and is axe clean', async () => {
    const { container } = render(<FeesTabs label="Fee views" tabs={TABS} />);
    const current = screen.getByRole('link', { name: 'Bank slips 3 slips waiting' });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Payments' })).not.toHaveAttribute('aria-current');
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(TABS.map((t) => t.href));
    await expectNoAxeViolations(container);
  });

  it('shows no number at zero and caps large counts', () => {
    const { rerender } = render(<FeesTabs label="Fee views" tabs={[{ ...SLIPS, count: 0 }]} />);
    expect(screen.getByRole('link', { name: 'Bank slips' })).toBeInTheDocument();
    rerender(<FeesTabs label="Fee views" tabs={[{ ...SLIPS, count: 140 }]} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });
});

describe('tabs by role (permissions.ts)', () => {
  it('gives every fees role the four tabs; teachers and gatekeepers none', () => {
    for (const role of ['owner', 'admin', 'cashier'] as const)
      expect(allowedFeesTabs([role])).toEqual(['payments', 'invoices', 'slips', 'cash']);
    expect(allowedFeesTabs(['teacher'])).toEqual([]);
    expect(allowedFeesTabs(['gatekeeper'])).toEqual([]);
  });

  it('falls back to Payments for an unknown tab or one the role may not open', () => {
    expect(resolveFeesTab('slips', ['cashier'])).toBe('slips');
    expect(resolveFeesTab(['cash', 'x'], ['owner'])).toBe('cash');
    expect(resolveFeesTab('nope', ['owner'])).toBe('payments');
    expect(resolveFeesTab('cash', ['teacher'])).toBe('payments');
    expect(resolveFeesTab(undefined, ['admin'])).toBe('payments');
  });
});
