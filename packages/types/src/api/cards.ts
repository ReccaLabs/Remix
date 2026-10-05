import { z } from 'zod';
import { isoDateTime } from './common';

/**
 * STU-06 — student cards.
 *
 * - `permanent`: printed by ReMix (Recca Labs). One card can carry a barcode, a QR code and an
 *   NFC chip together, or only a barcode; the barcode is always on it. Starts `ordered`, becomes
 *   `active` when the institute hands it over (which retires the temporary card).
 * - `temporary`: printed by the institute itself, barcode only, active at once.
 *
 * Every card's code is the student number plus a card sequence: `NIL-26-0042-1` is that
 * student's first card, `NIL-26-0042-2` the next. A lost card is revoked alone; the student number
 * typed on its own still finds the student. Barcode, QR and NFC (NDEF text) all carry this code;
 * a chip that was not programmed can be linked by its UID instead.
 */
export const CARD_KINDS = ['permanent', 'temporary'] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const CARD_FORMATS = ['barcode', 'qr', 'nfc'] as const;
export type CardFormat = (typeof CARD_FORMATS)[number];

export const CARD_STATUSES = ['ordered', 'active', 'revoked'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

/**
 * Canonical form of a scanned or typed card code or student number: trimmed, upper case, no
 * whitespace. Dashes are kept: `NIL-26-0042-1` and `NIL-26-00421` are different codes.
 */
export function normalizeCardInput(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/** NFC chip UID as hex: readers print `04:a2:1b:9c`, `04-A2-1B-9C` or `04A21B9C`. */
export function normalizeNfcUid(raw: string): string {
  return raw.replace(/[\s:-]/g, '').toUpperCase();
}

/** What the counter sends after a scan or typing: a card code, a student number or an NFC UID. */
export const cardInputSchema = z
  .string()
  .max(128)
  .transform(normalizeCardInput)
  .pipe(z.string().regex(/^[\x21-\x7E]{3,64}$/, 'Use 3–64 visible characters'));

export const nfcUidSchema = z
  .string()
  .max(64)
  .transform(normalizeNfcUid)
  .pipe(z.string().regex(/^[0-9A-F]{8,20}$/, 'Use the chip ID: 8–20 hex characters'));

const cardFormats = z
  .array(z.enum(CARD_FORMATS))
  .min(1)
  .max(3)
  .refine((f) => new Set(f).size === f.length, 'List each format once')
  .refine((f) => f.includes('barcode'), 'Every card has a barcode');

export const studentCardSchema = z.object({
  id: z.uuid(),
  studentId: z.uuid(),
  /** `<studentNo>-<n>`, e.g. `NIL-26-0042-1`. */
  code: z.string(),
  kind: z.enum(CARD_KINDS),
  formats: z.array(z.enum(CARD_FORMATS)),
  /** Last 4 hex characters of a linked chip UID, e.g. `••••1B9C`; null when none is linked. */
  nfcUidHint: z.string().nullable(),
  status: z.enum(CARD_STATUSES),
  issuedAt: isoDateTime,
  activatedAt: isoDateTime.nullable(),
  revokedAt: isoDateTime.nullable(),
  revokeReason: z.string().nullable(),
});
export type StudentCard = z.infer<typeof studentCardSchema>;

export const studentCardsResponseSchema = z.object({ items: z.array(studentCardSchema) });

/**
 * A temporary card is active at once and replaces (revokes) the current active card. A permanent
 * card is `ordered` alongside it; a student has at most one ordered card.
 */
export const issueStudentCardSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('temporary') }),
  z.strictObject({ kind: z.literal('permanent'), formats: cardFormats }),
]);
export type IssueStudentCardRequest = z.input<typeof issueStudentCardSchema>;

/** Hand over an ordered permanent card; optionally link the chip UID if it was not programmed. */
export const activateStudentCardSchema = z.strictObject({
  nfcUid: nfcUidSchema.optional(),
});
export type ActivateStudentCardRequest = z.input<typeof activateStudentCardSchema>;

export const revokeStudentCardSchema = z.strictObject({
  reason: z.string().trim().min(3).max(200),
});
export type RevokeStudentCardRequest = z.input<typeof revokeStudentCardSchema>;

/** POST body (not a query string) so card codes stay out of access logs. */
export const cardLookupSchema = z.strictObject({ input: cardInputSchema });
export type CardLookupRequest = z.input<typeof cardLookupSchema>;

/**
 * What the counter shows after a scan. `card` is null when a bare student number was typed.
 * Ordered and revoked cards still resolve so staff see "not handed over yet" / "card revoked".
 */
export const cardLookupResponseSchema = z.object({
  matchedBy: z.enum(['card', 'nfc', 'studentNo']),
  card: studentCardSchema.pick({ id: true, kind: true, status: true }).nullable(),
  student: z.object({
    id: z.uuid(),
    studentNo: z.string(),
    displayName: z.string(),
    archived: z.boolean(),
  }),
});
export type CardLookupResponse = z.infer<typeof cardLookupResponseSchema>;

/** Cards waiting to be printed by ReMix (Admin → Students → Cards); feeds the print sheet. */
export const orderedCardsResponseSchema = z.object({
  items: z.array(
    studentCardSchema.pick({ id: true, code: true, formats: true, issuedAt: true }).extend({
      studentId: z.uuid(),
      studentNo: z.string(),
      displayName: z.string(),
    }),
  ),
});
