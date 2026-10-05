import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgEnum, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, instant, tenantId } from './columns';
import { tenants } from './tenants';
import { students, tenantUsers } from './users';

export const cardFormat = pgEnum('card_format', ['barcode', 'qr', 'nfc']);
export const cardSource = pgEnum('card_source', ['issued', 'linked']);
export const cardStatus = pgEnum('card_status', ['active', 'revoked']);

/** STU-06: codes remain reserved after revocation; only lifecycle columns can change. */
export const studentCards = pgTable('student_cards', {
  id: id(), tenantId: tenantId().references(() => tenants.id),
  studentId: uuid('student_id').notNull(), code: text('code').notNull(),
  format: cardFormat('format').notNull(), source: cardSource('source').notNull(),
  status: cardStatus('status').notNull().default('active'),
  issuedAt: instant('issued_at').notNull().defaultNow(), issuedBy: uuid('issued_by').notNull(),
  revokedAt: instant('revoked_at'), revokedBy: uuid('revoked_by'), revokeReason: text('revoke_reason'),
}, t => [
  unique('student_cards_tenant_id_id_key').on(t.tenantId, t.id),
  unique('student_cards_tenant_code_key').on(t.tenantId, t.code),
  uniqueIndex('student_cards_tenant_active_key').on(t.tenantId, t.studentId).where(sql`${t.status} = 'active'`),
  index('student_cards_tenant_student_issued_idx').on(t.tenantId, t.studentId, t.issuedAt),
  foreignKey({ name: 'student_cards_student_fk', columns: [t.tenantId, t.studentId], foreignColumns: [students.tenantId, students.userId] }),
  foreignKey({ name: 'student_cards_issued_by_fk', columns: [t.tenantId, t.issuedBy], foreignColumns: [tenantUsers.tenantId, tenantUsers.id] }),
  foreignKey({ name: 'student_cards_revoked_by_fk', columns: [t.tenantId, t.revokedBy], foreignColumns: [tenantUsers.tenantId, tenantUsers.id] }),
  check('student_cards_code_format', sql`${t.code} ~ '^[A-Z0-9]{4,64}$'`),
  check('student_cards_revocation', sql`(${t.status} = 'active' AND ${t.revokedAt} IS NULL AND ${t.revokedBy} IS NULL AND ${t.revokeReason} IS NULL) OR (${t.status} = 'revoked' AND ${t.revokedAt} IS NOT NULL AND ${t.revokedBy} IS NOT NULL AND ${t.revokeReason} IS NOT NULL AND char_length(btrim(${t.revokeReason})) BETWEEN 3 AND 200)`),
]);
