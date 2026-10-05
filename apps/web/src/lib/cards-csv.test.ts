import { describe, expect, it } from 'vitest';
import { cardCsvCell, cardsCsv, cardSheets, type CardOrder } from './cards-csv';

const card: CardOrder = {
  id: 'card',
  studentId: 'student',
  code: 'NIL-26-0042-1',
  studentNo: 'NIL-26-0042',
  displayName: 'Sample, "Student"',
  formats: ['barcode', 'qr', 'nfc'],
  issuedAt: '2026-10-05T10:00:00Z',
};
describe('STU-06 vendor CSV and sheets', () => {
  it('guards every formula-leading character and quotes delimiters, quotes and newlines', () => {
    for (const value of ['=1+1', '+SUM(A1)', '-1', '@name', '\tformula', '\rformula'])
      expect(cardCsvCell(value)).toBe(`"'${value}"`);
    expect(cardCsvCell('Sample, "Student"\nName')).toBe('"Sample, ""Student""\nName"');
    const csv = cardsCsv([{ ...card, code: '=CODE', studentNo: '@NUMBER', displayName: '+NAME' }]);
    expect(csv).toContain('"\'=CODE","\'@NUMBER","\'+NAME","barcode|qr|nfc","\'=CODE"');
    expect(cardsCsv([card])).toContain(
      '"NIL-26-0042-1","NIL-26-0042","Sample, ""Student""","barcode|qr|nfc","NIL-26-0042-1"',
    );
  });
  it('places at most ten ordered cards on each A4 page, preserving order', () => {
    const cards = Array.from({ length: 21 }, (_, n) => ({ ...card, id: String(n) }));
    expect(cardSheets(cards).map((page) => page.length)).toEqual([10, 10, 1]);
    expect(cardSheets(cards).flat()).toEqual(cards);
    expect(cardSheets([])).toEqual([]);
  });
});
