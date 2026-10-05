import { listPaymentsQuerySchema, type ListPaymentsQuery } from '@remix/types/api';

const KEYS = ['from', 'to', 'method', 'studentId', 'needsRefund', 'page', 'pageSize'] as const;
export function paymentsQuery(params: Record<string, string | string[] | undefined>) {
  const picked: Record<string, string> = {};
  for (const key of KEYS) {
    const raw = params[key]; const value = Array.isArray(raw) ? raw[0] : raw;
    if (value) picked[key] = value;
  }
  const parsed = listPaymentsQuerySchema.safeParse(picked);
  return parsed.success ? parsed.data : listPaymentsQuerySchema.parse({});
}
export function paymentsHref(query: ListPaymentsQuery): string {
  const search = new URLSearchParams();
  for (const key of KEYS) if (query[key] !== undefined && query[key] !== '') search.set(key, String(query[key]));
  return `/admin/fees?${search.toString()}`;
}
