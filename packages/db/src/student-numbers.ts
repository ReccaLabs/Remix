import { sql, type SQL, type AnyColumn } from 'drizzle-orm';
import { normalizeCardInput } from '@remix/types/api';

/** Display spelling is preserved; identity and card printing use the contract's normal form. */
export const normalizeStudentNo = normalizeCardInput;

/** Keep this expression identical to the unique index in migration 0015. */
export function studentNoNormalForm(column: AnyColumn): SQL<string> {
  return sql<string>`upper(regexp_replace(${column}, '\\s', '', 'g'))`;
}
