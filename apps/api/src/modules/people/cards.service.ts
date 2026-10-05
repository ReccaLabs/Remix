import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, max, sql } from 'drizzle-orm';
import {
  normalizeStudentNo,
  studentNoNormalForm,
  schema,
  withTenant,
  type Db,
  type Tx,
} from '@remix/db';
import type { API, CardLookupResponse, StudentCard } from '@remix/types/api';
import type { z } from 'zod';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { AppException } from '../../common/errors/app-exception';
import { CLOCK, type Clock } from '../../common/time/clock';
import { AuditService, type AuditAction } from '../audit/audit.service';
import { DB } from '../db/db.module';

const { studentCards: cards, students, tenantUsers } = schema;
type CardRow = typeof cards.$inferSelect;
type Issue = z.output<typeof API.issueStudentCard.request>;
type Activate = z.output<typeof API.activateStudentCard.request>;
const missing = () => new AppException('NOT_FOUND', 404);
const conflict = (message: string) => new AppException('CONFLICT', 409, message);

/** Never returns the UID or lifecycle actors to an API response. */
export function presentCard(row: CardRow): StudentCard {
  return {
    id: row.id,
    studentId: row.studentId,
    code: row.code,
    kind: row.kind,
    formats: row.formats,
    nfcUidHint: row.nfcUid ? '\u2022\u2022\u2022\u2022' + row.nfcUid.slice(-4) : null,
    status: row.status,
    issuedAt: row.issuedAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokeReason: row.revokeReason,
  };
}

@Injectable()
export class CardsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, studentId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.student(tx, studentId);
      const rows = await tx
        .select()
        .from(cards)
        .where(eq(cards.studentId, studentId))
        .orderBy(desc(cards.cardSeq));
      return { items: rows.map(presentCard) };
    });
  }

  issue(tenantId: string, session: AuthSession, studentId: string, body: Issue) {
    return withTenant(this.db, tenantId, async (tx) => {
      const student = await this.student(tx, studentId, true);
      if (student.archivedAt)
        throw new AppException('VALIDATION_FAILED', 400, 'Archived students cannot receive cards');
      const number = normalizeStudentNo(student.studentNo);
      if (!/^[!-~]{3,60}$/.test(number) || number !== student.normalNo)
        throw new AppException(
          'VALIDATION_FAILED',
          400,
          'This student number cannot be printed on a card; change it first',
        );
      const now = this.clock.now();
      const [ordered] = await tx
        .select({ id: cards.id })
        .from(cards)
        .where(and(eq(cards.studentId, studentId), eq(cards.status, 'ordered')));
      if (body.kind === 'permanent' && ordered)
        throw conflict('A permanent card is already ordered');
      const [sequence] = await tx
        .select({ value: max(cards.cardSeq) })
        .from(cards)
        .where(eq(cards.studentId, studentId));
      const cardSeq = (sequence?.value ?? 0) + 1;
      if (body.kind === 'temporary')
        await this.replaceActive(tx, tenantId, session, studentId, now);
      const formats = body.kind === 'temporary' ? ['barcode'] : body.formats;
      // Explicit columns keep UUID generation in Postgres without granting INSERT on id.
      const inserted = await tx.execute<{ id: string }>(sql`
        insert into student_cards (tenant_id, student_id, card_seq, code, kind, formats, status,
          issued_at, issued_by, activated_at, activated_by)
        values (${tenantId}, ${studentId}, ${cardSeq}, ${`${number}-${cardSeq}`},
          ${body.kind}, ${sql.param(formats)}::card_format[], ${body.kind === 'temporary' ? 'active' : 'ordered'},
          ${now.toISOString()}, ${session.userId}, ${body.kind === 'temporary' ? now.toISOString() : null},
          ${body.kind === 'temporary' ? session.userId : null}) returning id`);
      const insertedId = inserted.rows[0]?.id;
      const [row] = insertedId ? await tx.select().from(cards).where(eq(cards.id, insertedId)) : [];
      if (!row) throw new Error('Card insert returned no row');
      await this.record(tx, tenantId, session, row, 'card.issue', now);
      return presentCard(row);
    });
  }

  async activate(tenantId: string, session: AuthSession, id: string, body: Activate) {
    try {
      return await withTenant(this.db, tenantId, async (tx) => {
        const row = await this.lockCard(tx, id);
        if (row.status !== 'ordered') throw conflict('Only an ordered card can be handed over');
        if (body.nfcUid && !row.formats.includes('nfc'))
          throw new AppException('VALIDATION_FAILED', 400, 'This card has no NFC chip');
        if (body.nfcUid) {
          const [taken] = await tx
            .select({ id: cards.id })
            .from(cards)
            .where(eq(cards.nfcUid, body.nfcUid));
          if (taken && taken.id !== id) throw conflict('This chip is already linked to a card');
        }
        const now = this.clock.now();
        await this.replaceActive(tx, tenantId, session, row.studentId, now);
        const [active] = await tx
          .update(cards)
          .set({
            status: 'active',
            activatedAt: now,
            activatedBy: session.userId,
            nfcUid: body.nfcUid ?? null,
          })
          .where(eq(cards.id, id))
          .returning();
        if (!active) throw missing();
        await this.record(tx, tenantId, session, active, 'card.activate', now);
        return presentCard(active);
      });
    } catch (error) {
      // Concurrent UID claims on different students serialize at the unique index. Never expose SQL/UID details.
      if (postgresCode(error) === '23505') throw conflict('This chip is already linked to a card');
      throw error;
    }
  }

  revoke(tenantId: string, session: AuthSession, id: string, reason: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const row = await this.lockCard(tx, id);
      if (row.status === 'revoked') throw conflict('This card is already revoked');
      const now = this.clock.now();
      const [revoked] = await tx
        .update(cards)
        .set({ status: 'revoked', revokedAt: now, revokedBy: session.userId, revokeReason: reason })
        .where(eq(cards.id, id))
        .returning();
      if (!revoked) throw missing();
      await this.record(tx, tenantId, session, revoked, 'card.revoke', now);
      return presentCard(revoked);
    });
  }

  ordered(tenantId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select({
          id: cards.id,
          code: cards.code,
          formats: cards.formats,
          issuedAt: cards.issuedAt,
          studentId: cards.studentId,
          studentNo: students.studentNo,
          displayName: tenantUsers.displayName,
        })
        .from(cards)
        .innerJoin(
          students,
          and(eq(students.tenantId, cards.tenantId), eq(students.userId, cards.studentId)),
        )
        .innerJoin(
          tenantUsers,
          and(eq(tenantUsers.tenantId, cards.tenantId), eq(tenantUsers.id, cards.studentId)),
        )
        .where(and(eq(cards.kind, 'permanent'), eq(cards.status, 'ordered')))
        .orderBy(asc(cards.issuedAt), asc(cards.id));
      return { items: rows.map((row) => ({ ...row, issuedAt: row.issuedAt.toISOString() })) };
    });
  }

  lookup(tenantId: string, input: string): Promise<CardLookupResponse> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [card] = await tx.select().from(cards).where(eq(cards.code, input));
      if (card) return this.lookupResult(tx, card.studentId, 'card', card);
      const [student] = await tx
        .select({ id: students.userId })
        .from(students)
        .where(eq(studentNoNormalForm(students.studentNo), input));
      if (student) return this.lookupResult(tx, student.id, 'studentNo', null);
      if (/^[0-9A-F]{8,20}$/.test(input)) {
        const [nfc] = await tx.select().from(cards).where(eq(cards.nfcUid, input));
        if (nfc) return this.lookupResult(tx, nfc.studentId, 'nfc', nfc);
      }
      throw missing();
    });
  }

  private async lookupResult(
    tx: Tx,
    id: string,
    matchedBy: CardLookupResponse['matchedBy'],
    card: CardRow | null,
  ): Promise<CardLookupResponse> {
    const [student] = await tx
      .select({
        id: students.userId,
        studentNo: students.studentNo,
        displayName: tenantUsers.displayName,
        archivedAt: students.archivedAt,
      })
      .from(students)
      .innerJoin(
        tenantUsers,
        and(eq(tenantUsers.tenantId, students.tenantId), eq(tenantUsers.id, students.userId)),
      )
      .where(eq(students.userId, id));
    if (!student) throw missing();
    return {
      matchedBy,
      card: card ? { id: card.id, kind: card.kind, status: card.status } : null,
      student: {
        id: student.id,
        studentNo: student.studentNo,
        displayName: student.displayName,
        archived: student.archivedAt !== null,
      },
    };
  }

  private async student(tx: Tx, id: string, lock = false) {
    const query = tx
      .select({
        studentNo: students.studentNo,
        archivedAt: students.archivedAt,
        normalNo: studentNoNormalForm(students.studentNo),
      })
      .from(students)
      .where(eq(students.userId, id));
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw missing();
    return row;
  }

  private async lockCard(tx: Tx, id: string): Promise<CardRow> {
    const [first] = await tx
      .select({ studentId: cards.studentId })
      .from(cards)
      .where(eq(cards.id, id));
    if (!first) throw missing();
    await this.student(tx, first.studentId, true);
    const [row] = await tx.select().from(cards).where(eq(cards.id, id));
    if (!row) throw missing();
    return row;
  }

  private async replaceActive(
    tx: Tx,
    tenantId: string,
    session: AuthSession,
    studentId: string,
    now: Date,
  ) {
    const revoked = await tx
      .update(cards)
      .set({
        status: 'revoked',
        revokedAt: now,
        revokedBy: session.userId,
        revokeReason: 'replaced',
      })
      .where(and(eq(cards.studentId, studentId), eq(cards.status, 'active')))
      .returning();
    for (const row of revoked) await this.record(tx, tenantId, session, row, 'card.revoke', now);
  }

  private record(
    tx: Tx,
    tenantId: string,
    session: AuthSession,
    row: CardRow,
    action: AuditAction,
    now: Date,
  ) {
    return this.audit.record(tx, tenantId, {
      action,
      actorId: session.userId,
      actorKind: 'staff',
      entity: 'student_card',
      entityId: row.id,
      after: { kind: row.kind, formats: row.formats, card_seq: row.cardSeq, status: row.status },
      at: now,
    });
  }
}

function postgresCode(error: unknown): string | undefined {
  for (let depth = 0; depth < 5 && error && typeof error === 'object'; depth++) {
    if ('code' in error && typeof error.code === 'string') return error.code;
    error = 'cause' in error ? error.cause : undefined;
  }
  return undefined;
}
