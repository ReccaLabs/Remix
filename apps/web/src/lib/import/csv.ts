/**
 * STU-04 — CSV reading and writing for the import wizard. Pure and dependency-free.
 *
 * Reading follows RFC 4180 (quoted cells, doubled quotes, line breaks inside quotes) and accepts
 * the delimiters spreadsheet programs actually produce (comma, semicolon, tab — Excel in many
 * locales writes `;`). Nothing is ever evaluated: cells are plain strings.
 *
 * Writing escapes spreadsheet formulas: a cell that starts with `=`, `+`, `-` or `@` (or a tab or
 * carriage return) is prefixed with `'`, so opening the error file in Excel or Sheets cannot run
 * an attacker's formula (CSV injection, T12). Reading undoes exactly that prefix, so a corrected
 * error file can be uploaded again.
 */

const DELIMITERS = [',', ';', '\t'] as const;

/** The delimiter used most on the first non-empty line, outside quotes. */
export function detectDelimiter(text: string): string {
  const counts = new Map<string, number>(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      if ([...counts.values()].some((n) => n > 0)) break;
    } else if (!quoted && counts.has(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let best: string = ',';
  let bestCount = 0;
  for (const [delimiter, count] of counts) {
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

/** Parse CSV text into rows of cells. Rows without any non-blank cell are dropped. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let cellStarted = false;

  const endCell = () => {
    row.push(cell);
    cell = '';
    cellStarted = false;
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && !cellStarted) {
      quoted = true;
      cellStarted = true;
    } else if (ch === delimiter) {
      endCell();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text.charAt(i + 1) === '\n') i += 1;
      endRow();
    } else {
      cell += ch;
      cellStarted = true;
    }
  }
  if (cellStarted || cell !== '' || row.length > 0) endRow();
  return rows;
}

/** A cell that spreadsheet software would read as a formula. */
const FORMULA = /^[=+\-@\t\r]/;

/** Escape one cell for CSV output: formula-neutral and quoted when it needs to be. */
export function csvCell(value: string): string {
  const safe = FORMULA.test(value) ? `'${value}` : value;
  return /[",\r\n;\t]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** `'=1+1` → `=1+1`: removes the prefix {@link csvCell} adds, nothing else. */
export function unescapeFormula(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}
