import { z } from 'zod';
import { isoDateTime } from './common';

/**
 * STU-06 — physical student cards. Each institute picks how its cards carry the code: a printed
 * barcode, a QR code or an NFC chip. ReMix only stores the code; the format says how to print it.
 */
export const CARD_FORMATS = ['barcode', 'qr', 'nfc'] as const;
export type CardFormat = (typeof CARD_FORMATS)[number];

/** `issued`: ReMix generated the code. `linked`: the institute's existing card number or NFC UID. */
export const CARD_SOURCES = ['issued', 'linked'] as const;
export type CardSource = (typeof CARD_SOURCES)[number];

export const CARD_STATUSES = ['active', 'revoked'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

/**
 * Canonical form of a scanned or typed card code: upper case, without spaces, `:` or `-`
 * (NFC readers print UIDs as `04:a2:…`, barcode labels often group digits with spaces or dashes).
 */
export function normalizeCardCode(raw: string): string {
  return raw.replace(/[\s:-]/g, '').toUpperCase();
}

/** A card code after normalisation: 4–64 letters/digits. */
export const cardCodeSchema = z
  .string()
  .max(128)
  .transform(normalizeCardCode)
  .pipe(z.string().regex(/^[A-Z0-9]{4,64}$/, 'Use 4–64 letters or digits'));

export const studentCardSchema = z.object({
  id: z.uuid(),
  studentId: z.uuid(),
  code: z.string(),
  format: z.enum(CARD_FORMATS),
  source: z.enum(CARD_SOURCES),
  status: z.enum(CARD_STATUSES),
  issuedAt: isoDateTime,
  revokedAt: isoDateTime.nullable(),
  revokeReason: z.string().nullable(),
});
export type StudentCard = z.infer<typeof studentCardSchema>;

export const studentCardsResponseSchema = z.object({ items: z.array(studentCardSchema) });

/**
 * Issue (no `code`: ReMix generates one) or link (with `code`: an existing card) a card. A student
 * has at most one active card; an existing active card is revoked with reason "replaced".
 */
export const issueStudentCardSchema = z.strictObject({
  format: z.enum(CARD_FORMATS),
  code: cardCodeSchema.optional(),
});
export type IssueStudentCardRequest = z.input<typeof issueStudentCardSchema>;

export const revokeStudentCardSchema = z.strictObject({
  reason: z.string().trim().min(3).max(200),
});
export type RevokeStudentCardRequest = z.input<typeof revokeStudentCardSchema>;

/** POST body (not a query string) so card codes stay out of access logs. */
export const cardLookupSchema = z.strictObject({ code: cardCodeSchema });
export type CardLookupRequest = z.input<typeof cardLookupSchema>;

/** What the counter shows after a scan; a revoked card still resolves so staff see "card revoked". */
export const cardLookupResponseSchema = z.object({
  card: studentCardSchema.pick({ id: true, format: true, status: true }),
  student: z.object({
    id: z.uuid(),
    displayName: z.string(),
    archived: z.boolean(),
  }),
});
export type CardLookupResponse = z.infer<typeof cardLookupResponseSchema>;
