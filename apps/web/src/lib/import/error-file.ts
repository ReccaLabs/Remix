import {
  IMPORT_FIELDS,
  type ImportField,
  type ImportRow,
  type ImportRowResult,
} from '@remix/types/api';
import { toCsv } from './csv';

/**
 * STU-04 — the downloadable file of rows that were not imported: the row number, why, and the
 * student's data in the import's own column layout, so the file can be corrected and uploaded
 * again. Cells that look like formulas are neutralised by {@link toCsv}.
 */

export interface ErrorFileLabels {
  row: string;
  status: string;
  problems: string;
  /** Column heading per import field (also what the auto-mapping recognises on re-upload). */
  fields: Record<ImportField, string>;
  statusWord(status: ImportRowResult['status']): string;
  /** One sentence for a row: its errors, or whom it duplicates. */
  describe(result: ImportRowResult): string;
}

/** Rows that need attention (everything but `ok`), in file order. */
export function problemRows(results: readonly ImportRowResult[]): ImportRowResult[] {
  return results.filter((r) => r.status !== 'ok');
}

/** The CSV text of the error file, with a byte-order mark so Excel reads Sinhala/Tamil right. */
export function buildErrorCsv(
  rows: readonly ImportRow[],
  results: readonly ImportRowResult[],
  labels: ErrorFileLabels,
): string {
  const header = [
    labels.row,
    labels.status,
    labels.problems,
    ...IMPORT_FIELDS.map((f) => labels.fields[f]),
  ];
  const body = problemRows(results).map((result) => {
    const source = rows[result.rowNo - 1] ?? {};
    return [
      String(result.rowNo),
      labels.statusWord(result.status),
      labels.describe(result),
      ...IMPORT_FIELDS.map((f) => source[f] ?? ''),
    ];
  });
  return `﻿${toCsv([header, ...body])}`;
}
