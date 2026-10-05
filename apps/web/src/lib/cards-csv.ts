import type { CardFormat } from '@remix/types/api';

export interface CardOrder {
  id: string;
  studentId: string;
  code: string;
  studentNo: string;
  displayName: string;
  formats: CardFormat[];
  issuedAt: string;
}

/** Spreadsheet applications interpret these leading characters even inside quoted CSV cells. */
export function cardCsvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function cardsCsv(cards: readonly CardOrder[]): string {
  // Vendor field names are the export protocol; the NDEF text payload is the stable card code.
  return (
    '\uFEFFcard_code,student_number,name,formats,nfc_payload\r\n' +
    cards
      .map((card) =>
        [card.code, card.studentNo, card.displayName, card.formats.join('|'), card.code]
          .map(cardCsvCell)
          .join(','),
      )
      .join('\r\n') +
    '\r\n'
  );
}

export function cardSheets(cards: readonly CardOrder[]): CardOrder[][] {
  const pages: CardOrder[][] = [];
  for (let i = 0; i < cards.length; i += 10) pages.push(cards.slice(i, i + 10));
  return pages;
}
