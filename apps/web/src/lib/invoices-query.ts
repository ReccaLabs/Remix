import { listInvoicesQuerySchema, type ListInvoicesQuery } from '@remix/types/api';

const KEYS = ['month', 'filter', 'classId', 'q', 'page', 'pageSize'] as const;

/** Invoices tab query from the page's search params; anything invalid falls back to defaults. */
export function invoicesQuery(params: Record<string, string | string[] | undefined>) {
  const picked: Record<string, string> = {};
  for (const key of KEYS) {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value) picked[key] = value;
  }
  const parsed = listInvoicesQuerySchema.safeParse(picked);
  return parsed.success ? parsed.data : listInvoicesQuerySchema.parse({});
}

export function invoicesHref(query: ListInvoicesQuery): string {
  const search = new URLSearchParams({ tab: 'invoices' });
  for (const key of KEYS) {
    const value = query[key];
    if (value !== undefined && value !== '' && !(key === 'filter' && value === 'all')) search.set(key, String(value));
  }
  return `/admin/fees?${search.toString()}`;
}

/** The last `count` billing months up to and including `current` (`YYYY-MM-01`), newest first. */
export function recentMonths(current: string, count = 12): string[] {
  const [year, month] = current.split('-').map(Number);
  if (year === undefined || month === undefined) return [];
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  });
}
