import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, instant, tenantId } from './columns';
import { tenants } from './tenants';
import { students, tenantUsers } from './users';

export const cardFormat = pgEnum('card_format', ['barcode', 'qr', 'nfc']);
export const cardKind = pgEnum('card_kind', ['permanent', 'temporary']);
export const cardStatus = pgEnum('card_status', ['ordered', 'active', 'revoked']);

/** STU-06: codes, sequences and chip UIDs remain reserved after revocation. */
export const studentCards = pgTable(
  'student_cards',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    studentId: uuid('student_id').notNull(),
    cardSeq: integer('card_seq').notNull(),
    code: text('code').notNull(),
    kind: cardKind('kind').notNull(),
    formats: cardFormat('formats').array().notNull(),
    nfcUid: text('nfc_uid'),
    status: cardStatus('status').notNull(),
    issuedAt: instant('issued_at').notNull().defaultNow(),
    issuedBy: uuid('issued_by').notNull(),
    activatedAt: instant('activated_at'),
    activatedBy: uuid('activated_by'),
    revokedAt: instant('revoked_at'),
    revokedBy: uuid('revoked_by'),
    revokeReason: text('revoke_reason'),
  },
  (t) => [
    unique('student_cards_tenant_id_id_key').on(t.tenantId, t.id),
    unique('student_cards_tenant_seq_key').on(t.tenantId, t.studentId, t.cardSeq),
    unique('student_cards_tenant_code_key').on(t.tenantId, t.code),
    unique('student_cards_tenant_nfc_key').on(t.tenantId, t.nfcUid),
    uniqueIndex('student_cards_tenant_active_key')
      .on(t.tenantId, t.studentId)
      .where(sql`${t.status} = 'active'`),
    uniqueIndex('student_cards_tenant_ordered_key')
      .on(t.tenantId, t.studentId)
      .where(sql`${t.status} = 'ordered'`),
    index('student_cards_tenant_student_issued_idx').on(t.tenantId, t.studentId, t.issuedAt),
    foreignKey({
      name: 'student_cards_student_fk',
      columns: [t.tenantId, t.studentId],
      foreignColumns: [students.tenantId, students.userId],
    }),
    foreignKey({
      name: 'student_cards_issued_by_fk',
      columns: [t.tenantId, t.issuedBy],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    foreignKey({
      name: 'student_cards_activated_by_fk',
      columns: [t.tenantId, t.activatedBy],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    foreignKey({
      name: 'student_cards_revoked_by_fk',
      columns: [t.tenantId, t.revokedBy],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    check('student_cards_seq_positive', sql`${t.cardSeq} >= 1`),
    check('student_cards_code_length', sql`char_length(${t.code}) BETWEEN 3 AND 64`),
    check(
      'student_cards_formats',
      sql`array_position(${t.formats}, NULL) IS NULL AND 'barcode' = ANY(${t.formats}) AND cardinality(${t.formats}) = (('barcode' = ANY(${t.formats}))::int + ('qr' = ANY(${t.formats}))::int + ('nfc' = ANY(${t.formats}))::int)`,
    ),
    check(
      'student_cards_temporary',
      sql`${t.kind} <> 'temporary' OR (${t.formats} = ARRAY['barcode']::card_format[] AND ${t.status} <> 'ordered')`,
    ),
    check(
      'student_cards_nfc',
      sql`${t.nfcUid} IS NULL OR (${t.nfcUid} ~ '^[0-9A-F]{8,20}$' AND 'nfc' = ANY(${t.formats}))`,
    ),
    check(
      'student_cards_activation',
      sql`(${t.activatedAt} IS NULL) = (${t.activatedBy} IS NULL) AND (${t.status} <> 'active' OR ${t.activatedAt} IS NOT NULL) AND (${t.status} <> 'ordered' OR ${t.activatedAt} IS NULL)`,
    ),
    check(
      'student_cards_revocation',
      sql`(${t.status} <> 'revoked' AND ${t.revokedAt} IS NULL AND ${t.revokedBy} IS NULL AND ${t.revokeReason} IS NULL) OR (${t.status} = 'revoked' AND ${t.revokedAt} IS NOT NULL AND ${t.revokedBy} IS NOT NULL AND ${t.revokeReason} IS NOT NULL AND char_length(btrim(${t.revokeReason})) BETWEEN 3 AND 200)`,
    ),
  ],
);
