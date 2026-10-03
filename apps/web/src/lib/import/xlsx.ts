import { strFromU8, unzipSync } from 'fflate';

/**
 * STU-04 — read the first worksheet of an `.xlsx` file as rows of strings, in the browser.
 *
 * Why not SheetJS (plan B5): its npm package is unmaintained and has had prototype-pollution and
 * ReDoS advisories, and it is a large attack surface for a file the user did not write. An
 * `.xlsx` is a zip of XML files; `fflate` (tiny, no dependencies, no known advisories) unzips it
 * and the browser's own `DOMParser` reads the XML, so no spreadsheet engine ever runs. Formulas
 * are never calculated — only the cached value Excel stored is read, as text.
 *
 * Limits: the zip is not trusted. Only the four parts we need are inflated, each at most
 * {@link MAX_PART_BYTES} and together {@link MAX_TOTAL_BYTES} (zip bombs), and a sheet with more
 * than {@link MAX_CELLS} cells is refused. Dates come out as Excel serial numbers (we cannot tell
 * a date cell from a number without styles); the import has no date column.
 */

export const MAX_PART_BYTES = 40 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
export const MAX_CELLS = 400_000;

export class XlsxError extends Error {
  constructor(readonly reason: 'invalid' | 'tooLarge') {
    super(`xlsx: ${reason}`);
    this.name = 'XlsxError';
  }
}

const WANTED =
  /^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/;

function inflate(data: Uint8Array): Record<string, Uint8Array> {
  let total = 0;
  let tooLarge = false;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (file) => {
        if (!WANTED.test(file.name)) return false;
        total += file.originalSize;
        if (file.originalSize > MAX_PART_BYTES || total > MAX_TOTAL_BYTES) {
          tooLarge = true;
          return false;
        }
        return true;
      },
    });
  } catch {
    throw new XlsxError('invalid');
  }
  if (tooLarge) throw new XlsxError('tooLarge');
  return files;
}

function parseXml(bytes: Uint8Array | undefined): Document {
  if (!bytes) throw new XlsxError('invalid');
  const doc = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new XlsxError('invalid');
  return doc;
}

const all = (parent: Document | Element, name: string): Element[] =>
  Array.from(parent.getElementsByTagNameNS('*', name));

const children = (parent: Element, name: string): Element[] =>
  Array.from(parent.children).filter((c) => c.localName === name);

/** Text of a shared/inline string item: its `<t>` runs, without phonetic hints (`rPh`). */
function itemText(item: Element): string {
  let text = '';
  for (const child of Array.from(item.children)) {
    if (child.localName === 't') text += child.textContent ?? '';
    else if (child.localName === 'r') {
      for (const t of children(child, 't')) text += t.textContent ?? '';
    }
  }
  return text;
}

/** `B3` → column index 1. */
function columnIndex(ref: string): number {
  const letters = /^[A-Za-z]+/.exec(ref)?.[0].toUpperCase() ?? '';
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

/** Path (inside the zip) of the first sheet in workbook order. */
function firstSheetPath(files: Record<string, Uint8Array>): string {
  const workbook = parseXml(files['xl/workbook.xml']);
  const sheet = all(workbook, 'sheet')[0];
  const relId =
    sheet?.getAttributeNS(
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'id',
    ) ?? sheet?.getAttribute('r:id');
  if (relId && files['xl/_rels/workbook.xml.rels']) {
    const rels = parseXml(files['xl/_rels/workbook.xml.rels']);
    const target = all(rels, 'Relationship')
      .find((r) => r.getAttribute('Id') === relId)
      ?.getAttribute('Target');
    if (target) {
      const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
      if (files[path]) return path;
    }
  }
  const fallback = Object.keys(files)
    .filter((name) => name.startsWith('xl/worksheets/'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))[0];
  if (!fallback) throw new XlsxError('invalid');
  return fallback;
}

export function parseXlsx(data: Uint8Array): string[][] {
  const files = inflate(data);
  const shared: string[] = files['xl/sharedStrings.xml']
    ? all(parseXml(files['xl/sharedStrings.xml']), 'si').map(itemText)
    : [];
  const sheet = parseXml(files[firstSheetPath(files)]);

  const rows: string[][] = [];
  let cells = 0;
  for (const rowEl of all(sheet, 'row')) {
    const out: string[] = [];
    let colCursor = 0;
    for (const cell of children(rowEl, 'c')) {
      cells += 1;
      if (cells > MAX_CELLS) throw new XlsxError('tooLarge');
      const ref = cell.getAttribute('r');
      const col = ref ? columnIndex(ref) : colCursor;
      colCursor = col + 1;
      if (col < 0 || col > 16_383) continue;
      const value = cellValue(cell, shared);
      if (value === '') continue;
      while (out.length < col) out.push('');
      out[col] = value;
    }
    // Blank rows are dropped, as when reading a CSV.
    if (out.some((v) => v.trim() !== '')) rows.push(out);
  }
  return rows;
}

function cellValue(cell: Element, shared: readonly string[]): string {
  const type = cell.getAttribute('t');
  const raw = children(cell, 'v')[0]?.textContent ?? '';
  switch (type) {
    case 's':
      return shared[Number(raw)] ?? '';
    case 'inlineStr': {
      const inline = children(cell, 'is')[0];
      return inline ? itemText(inline) : '';
    }
    case 'b':
      return raw === '1' ? 'TRUE' : 'FALSE';
    case 'e':
      return '';
    default:
      // 'str' (formula text result), 'n' and untyped numbers: the stored value, as text.
      return raw;
  }
}
