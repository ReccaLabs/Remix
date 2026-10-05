import type { Receipt } from '@remix/types/api';
import { formatLKR } from '@remix/types/money';

// PDF 1.4, Courier core font. TODO: embed a Unicode font and shape Sinhala/Tamil before those
// locales go live. This Latin-only R1 writer replaces unsupported glyphs with '?' explicitly.
const latin = (text: string) =>
  text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\x20-\x7e\n]/g, '?');
const literal = (text: string) => text.replace(/[\\()]/g, '\\$&');
function wrap(text: string, width = 84): string[] {
  return latin(text)
    .split(/\r?\n/)
    .flatMap((line) => {
      const result: string[] = [];
      while (line.length > width) {
        const space = line.lastIndexOf(' ', width);
        const end = space > 0 ? space : width;
        result.push(line.slice(0, end));
        line = line.slice(end).trimStart();
      }
      result.push(line);
      return result;
    });
}

/** Bounded text streams, byte-accurate xref, wrapping and pagination; never interpret HTML. */
export function renderReceiptPdf(receipt: Receipt): Buffer {
  const money = (value: number) => formatLKR(value, { exact: true });
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(receipt.issuedAt));
  const text = [
    receipt.institute.name,
    receipt.institute.address ?? '',
    receipt.institute.phone ?? '',
    '',
    `Receipt ${receipt.number}`,
    `Issued: ${date} (Asia/Colombo)`,
    `Student: ${receipt.studentName} (${receipt.studentNo})`,
    `Method: ${receipt.method}`,
    ...(receipt.reversedAt ? ['REVERSED'] : []),
    '',
    ...receipt.lines.map(
      (line) => `${line.month.slice(0, 7)}  ${line.className}  ${money(line.amountCents)}`,
    ),
    '',
    `Total: ${money(receipt.amountCents)}`,
    ...(receipt.cashReceivedCents !== null
      ? [
          `Cash received: ${money(receipt.cashReceivedCents)}`,
          `Change: ${money(receipt.changeCents ?? 0)}`,
        ]
      : []),
    '',
    receipt.institute.footer ?? '',
  ];
  const lines = text.flatMap((line) => wrap(line));
  const pages: string[][] = [];
  for (let offset = 0; offset < lines.length; offset += 52)
    pages.push(lines.slice(offset, offset + 52));
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>'];
  const pageIds: number[] = [];
  for (const page of pages) {
    const pageId = objects.length + 1;
    const streamId = pageId + 1;
    pageIds.push(pageId);
    const stream = `BT\n/F1 10 Tf\n14 TL\n40 800 Td\n${page.map((line) => `(${literal(line)}) Tj\nT*`).join('\n')}\nET\n`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}endstream`,
    );
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output, 'ascii'));
    output += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output, 'ascii');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, 'ascii');
}
