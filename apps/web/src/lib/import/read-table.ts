import { IMPORT_MAX_ROWS } from '@remix/types/api';
import { parseCsv, unescapeFormula } from './csv';
import { parseXlsx, XlsxError } from './xlsx';

/** The largest upload the wizard reads (plan B5 / T12). */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export interface Table {
  headers: string[];
  /** Data rows, each as wide as the header row. */
  rows: string[][];
}

/** Why a file could not be used; the wizard shows a message per reason. */
export type FileProblem =
  'tooLarge' | 'unsupported' | 'unreadable' | 'empty' | 'tooManyRows';

export class FileReadError extends Error {
  constructor(readonly problem: FileProblem) {
    super(`import file: ${problem}`);
    this.name = 'FileReadError';
  }
}

const TEXT_TYPES = /\.(?:csv|tsv|txt)$/i;
const XLSX_TYPE = /\.xlsx$/i;

/** Header row + data rows from raw cells. Pure; exported for tests. */
export function toTable(cells: readonly (readonly string[])[]): Table {
  const [first, ...rest] = cells;
  if (!first || first.every((c) => c.trim() === '')) throw new FileReadError('empty');
  if (rest.length === 0) throw new FileReadError('empty');
  if (rest.length > IMPORT_MAX_ROWS) throw new FileReadError('tooManyRows');
  const width = Math.max(first.length, ...rest.map((r) => r.length));
  const clean = (cell: string | undefined) => unescapeFormula((cell ?? '').trim());
  return {
    headers: Array.from({ length: width }, (_, i) => clean(first[i])),
    rows: rest.map((r) => Array.from({ length: width }, (_, i) => clean(r[i]))),
  };
}

/** Read a CSV/TSV/`.xlsx` file in the browser. Rejects with {@link FileReadError}. */
export async function readTable(file: File): Promise<Table> {
  if (file.size > MAX_FILE_BYTES) throw new FileReadError('tooLarge');
  const isText = TEXT_TYPES.test(file.name);
  if (!isText && !XLSX_TYPE.test(file.name)) throw new FileReadError('unsupported');
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new FileReadError('unreadable');
  }
  if (isText) {
    return toTable(parseCsv(new TextDecoder('utf-8').decode(buffer)));
  }
  try {
    return toTable(parseXlsx(new Uint8Array(buffer)));
  } catch (error) {
    if (error instanceof FileReadError) throw error;
    throw new FileReadError(
      error instanceof XlsxError && error.reason === 'tooLarge' ? 'tooLarge' : 'unreadable',
    );
  }
}
