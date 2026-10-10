/**
 * One CSV cell. Spreadsheet applications interpret a leading `= + - @ tab CR` as a formula even
 * inside a quoted cell, so those are prefixed with an apostrophe.
 */
export function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** UTF-8 CSV with a BOM (so Excel reads Sinhala/Tamil names) and CRLF line ends. */
export function csvDocument(header: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
