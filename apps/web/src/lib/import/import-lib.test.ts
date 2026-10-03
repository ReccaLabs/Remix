// @vitest-environment jsdom
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { IMPORT_FIELDS, IMPORT_MAX_ROWS, type ImportRowResult } from '@remix/types/api';
import { csvCell, detectDelimiter, parseCsv, toCsv, unescapeFormula } from './csv';
import { buildErrorCsv, problemRows, type ErrorFileLabels } from './error-file';
import {
  applyMapping,
  duplicateColumns,
  guessMapping,
  missingRequired,
  normaliseHeader,
} from './mapping';
import { FileReadError, readTable, toTable, MAX_FILE_BYTES } from './read-table';
import { parseXlsx, XlsxError } from './xlsx';

describe('parseCsv', () => {
  it('reads quoted cells, doubled quotes and line breaks inside quotes', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n"two\nlines",z')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['two\nlines', 'z'],
    ]);
  });

  it('drops a byte-order mark and blank rows, keeps empty cells', () => {
    expect(parseCsv('﻿name,phone\n\n,077\n  ,  \nx,')).toEqual([
      ['name', 'phone'],
      ['', '077'],
      ['x', ''],
    ]);
  });

  it('detects semicolon and tab delimiters (outside quotes)', () => {
    expect(detectDelimiter('a;b;c\n1,2,3')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('"a;b;c",d')).toBe(',');
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads Sinhala and Tamil text unchanged', () => {
    expect(parseCsv('නම,பெயர்\nසුනිල්,கமல்')[1]).toEqual(['සුනිල්', 'கமல்']);
  });

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n\n')).toEqual([]);
  });
});

describe('csv output and formula injection (T12)', () => {
  it.each(['=HYPERLINK("http://evil.example","x")', '+1+1', '-2+3', '@SUM(1)', '\t=1', '\r=1'])(
    'prefixes %j with an apostrophe',
    (value) => {
      expect(csvCell(value).replace(/^"/, '').startsWith("'")).toBe(true);
    },
  );

  it('leaves ordinary cells alone and quotes only when needed', () => {
    expect(csvCell('Nimali')).toBe('Nimali');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('x=1')).toBe('x=1');
  });

  it('round-trips through the parser, undoing only its own prefix', () => {
    const cells = ['=HYPERLINK("x")', '+94771234567', 'plain', "'quoted"];
    const parsed = parseCsv(toCsv([cells]))[0]?.map(unescapeFormula);
    expect(parsed).toEqual(cells);
  });
});

describe('column mapping', () => {
  it('guesses from friendly header names, once per column', () => {
    const m = guessMapping([
      'Student Name',
      'Mobile No.',
      'Parent Phone',
      'A/L Year',
      'Classes',
      'Notes',
    ]);
    expect(m).toMatchObject({
      displayName: 0,
      phone: 1,
      guardianPhone: 2,
      alYear: 3,
      classes: 4,
      school: null,
    });
    expect(duplicateColumns(m)).toEqual([]);
  });

  it('recognises its own error-file headings', () => {
    const labels = Object.fromEntries(IMPORT_FIELDS.map((f) => [f, f]));
    const m = guessMapping(['Row', 'Status', 'Problems', ...IMPORT_FIELDS.map((f) => labels[f]!)]);
    expect(IMPORT_FIELDS.every((f) => m[f] !== null)).toBe(true);
  });

  it('reports missing required fields and shared columns', () => {
    const m = guessMapping(['School']);
    expect(missingRequired(m)).toEqual(['displayName', 'phone']);
    expect(duplicateColumns({ ...m, displayName: 0 })).toEqual(['school']);
  });

  it('applyMapping keeps mapped, non-empty, trimmed cells and caps their length', () => {
    const m = guessMapping(['Name', 'Phone', 'School']);
    expect(
      applyMapping(
        [
          [' Nimali ', '077 123 4567', ''],
          ['Kasun', '0771', 'x'.repeat(600)],
        ],
        m,
      ),
    ).toEqual([
      { displayName: 'Nimali', phone: '077 123 4567' },
      { displayName: 'Kasun', phone: '0771', school: 'x'.repeat(500) },
    ]);
  });

  it('normaliseHeader ignores case, spaces and punctuation', () => {
    expect(normaliseHeader(' Guardian_Phone ')).toBe('guardianphone');
  });
});

describe('toTable / readTable', () => {
  it('splits the header from rows, pads short rows, undoes the formula prefix', () => {
    expect(
      toTable([
        ['Name', 'Phone', 'School'],
        ['A', "'+94771234567"],
        ['B', '077', 'S', 'extra'],
      ]),
    ).toEqual({
      headers: ['Name', 'Phone', 'School', ''],
      rows: [
        ['A', '+94771234567', '', ''],
        ['B', '077', 'S', 'extra'],
      ],
    });
  });

  it('refuses a file with no data rows or more than 5,000', () => {
    expect(() => toTable([['Name']])).toThrow(FileReadError);
    expect(() => toTable([])).toThrow(FileReadError);
    const many = [['Name'], ...Array.from({ length: IMPORT_MAX_ROWS + 1 }, () => ['x'])];
    expect(() => toTable(many)).toThrow(expect.objectContaining({ problem: 'tooManyRows' }));
    expect(toTable([['Name'], ...many.slice(1, IMPORT_MAX_ROWS + 1)]).rows).toHaveLength(
      IMPORT_MAX_ROWS,
    );
  });

  it('reads a CSV File and rejects unsupported or oversized files', async () => {
    const csv = new File(['Name,Phone\nNimali,0771234567\n'], 'students.CSV', { type: 'text/csv' });
    expect(await readTable(csv)).toEqual({
      headers: ['Name', 'Phone'],
      rows: [['Nimali', '0771234567']],
    });
    await expect(readTable(new File(['x'], 'students.xls'))).rejects.toMatchObject({
      problem: 'unsupported',
    });
    await expect(readTable(new File(['x'], 'students.pdf'))).rejects.toMatchObject({
      problem: 'unsupported',
    });
    const big = new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'big.csv');
    await expect(readTable(big)).rejects.toMatchObject({ problem: 'tooLarge' });
    await expect(readTable(new File([''], 'empty.csv'))).rejects.toMatchObject({
      problem: 'empty',
    });
  });
});

/** A minimal but Excel-shaped workbook: shared strings, numbers, booleans, sparse cells. */
function workbook(sheetXml: string, shared = '', extra: Record<string, Uint8Array> = {}) {
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'xl/workbook.xml': strToU8(
      `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Students" sheetId="1" r:id="rId2"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    ),
    ...(shared ? { 'xl/sharedStrings.xml': strToU8(`<sst xmlns="${ns}">${shared}</sst>`) } : {}),
    'xl/worksheets/sheet1.xml': strToU8(
      `<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>wrong sheet</t></is></c></row></sheetData></worksheet>`,
    ),
    'xl/worksheets/sheet2.xml': strToU8(
      `<worksheet xmlns="${ns}"><sheetData>${sheetXml}</sheetData></worksheet>`,
    ),
    ...extra,
  });
}

describe('parseXlsx', () => {
  it('reads shared strings, numbers, booleans and inline strings from the sheet the workbook lists first', () => {
    const data = workbook(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>771234567</v></c><c r="C2" t="b"><v>1</v></c></row>' +
        '<row r="4"><c r="A4" t="inlineStr"><is><t>Kasun</t></is></c><c r="C4" t="e"><v>#N/A</v></c><c r="D4" t="str"><v>done</v></c></row>',
      '<si><t>Name</t></si><si><t>Phone</t></si><si><t>Under 18</t></si>' +
        '<si><r><t>Nim</t></r><r><t>ali</t></r><rPh><t>ignored</t></rPh></si>',
    );
    expect(parseXlsx(data)).toEqual([
      ['Name', 'Phone', 'Under 18'],
      ['Nimali', '771234567', 'TRUE'],
      ['Kasun', '', '', 'done'],
    ]);
  });

  it('places cells by column letter, leaving gaps empty', () => {
    const data = workbook(
      '<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="AA1" t="inlineStr"><is><t>z</t></is></c></row>',
    );
    const [row] = parseXlsx(data);
    expect(row?.[0]).toBe('a');
    expect(row?.[26]).toBe('z');
    expect(row?.slice(1, 26).every((c) => c === '')).toBe(true);
  });

  it('never evaluates formulas: it returns the stored value as text', () => {
    const data = workbook(
      '<row r="1"><c r="A1" t="str"><f>HYPERLINK("http://evil.example")</f><v>=HYPERLINK("x")</v></c></row>',
    );
    expect(parseXlsx(data)).toEqual([['=HYPERLINK("x")']]);
  });

  it('rejects things that are not a workbook', () => {
    expect(() => parseXlsx(strToU8('not a zip'))).toThrow(XlsxError);
    expect(() => parseXlsx(zipSync({ 'readme.txt': strToU8('hi') }))).toThrow(XlsxError);
    const badXml = zipSync({
      'xl/workbook.xml': strToU8('<workbook><sheets><sheet'),
      'xl/worksheets/sheet1.xml': strToU8('<worksheet/>'),
    });
    expect(() => parseXlsx(badXml)).toThrow(XlsxError);
  });

  it('refuses a zip bomb before inflating it', () => {
    const bomb = zipSync({
      'xl/workbook.xml': strToU8('<workbook/>'),
      'xl/worksheets/sheet1.xml': new Uint8Array(45 * 1024 * 1024),
    });
    expect(bomb.length).toBeLessThan(200 * 1024);
    expect(() => parseXlsx(bomb)).toThrow(expect.objectContaining({ reason: 'tooLarge' }));
  });

  it('is read through readTable for .xlsx files', async () => {
    const data = workbook(
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Phone</t></is></c></row>' +
        '<row r="2"><c r="A2" t="inlineStr"><is><t>Nimali</t></is></c><c r="B2"><v>771234567</v></c></row>',
    );
    const file = new File([data as BlobPart], 'students.xlsx');
    expect(await readTable(file)).toEqual({
      headers: ['Name', 'Phone'],
      rows: [['Nimali', '771234567']],
    });
    await expect(readTable(new File(['junk'], 'broken.xlsx'))).rejects.toMatchObject({
      problem: 'unreadable',
    });
  });
});

describe('buildErrorCsv', () => {
  const fields = Object.fromEntries(
    IMPORT_FIELDS.map((f) => [f, `<${f}>`]),
  ) as ErrorFileLabels['fields'];
  const labels: ErrorFileLabels = {
    row: 'Row',
    status: 'Status',
    problems: 'Problems',
    fields,
    statusWord: (s) => s.toUpperCase(),
    describe: (r) => r.errors.map((e) => `${e.field}: ${e.message}`).join(' | ') || 'duplicate',
  };
  const results: ImportRowResult[] = [
    { rowNo: 1, status: 'ok', errors: [], duplicateOf: null },
    {
      rowNo: 2,
      status: 'error',
      errors: [{ field: 'phone', message: 'bad, phone' }],
      duplicateOf: null,
    },
    { rowNo: 3, status: 'duplicate', errors: [], duplicateOf: { studentNo: 'BR-1', rowNo: null } },
  ];

  it('lists only rows that were not imported, with their data, in a re-uploadable layout', () => {
    expect(problemRows(results).map((r) => r.rowNo)).toEqual([2, 3]);
    const csv = buildErrorCsv(
      [
        { displayName: 'Ok', phone: '0771' },
        { displayName: 'Bad', phone: 'x' },
        { displayName: 'Dup', phone: '0772' },
      ],
      results,
      labels,
    );
    expect(csv.startsWith('﻿Row,Status,Problems,<displayName>,<phone>')).toBe(true);
    const parsed = parseCsv(csv);
    expect(parsed).toHaveLength(3);
    expect(parsed[1]).toEqual([
      '2',
      'ERROR',
      'phone: bad, phone',
      'Bad',
      'x',
      ...Array(10).fill(''),
    ]);
    expect(parsed[2]?.slice(0, 5)).toEqual(['3', 'DUPLICATE', 'duplicate', 'Dup', '0772']);
  });

  it('neutralises formulas in the data and in the messages', () => {
    const csv = buildErrorCsv(
      [
        {
          displayName: '=HYPERLINK("http://evil.example","x")',
          phone: '+94771234567',
          school: '@cmd',
        },
      ],
      [{ rowNo: 1, status: 'error', errors: [{ field: 'x', message: '-bad' }], duplicateOf: null }],
      { ...labels, describe: () => '=1+1' },
    );
    const [, row] = parseCsv(csv);
    expect(row?.slice(2, 6)).toEqual([
      "'=1+1",
      '\'=HYPERLINK("http://evil.example","x")',
      "'+94771234567",
      '',
    ]);
    expect(row).toContain("'@cmd");
    // No cell in the file starts with a formula character.
    for (const cell of parsed(csv).flat()) expect(/^[=+\-@]/.test(cell.trim())).toBe(false);
  });
});

const parsed = (csv: string) => parseCsv(csv).slice(1);
