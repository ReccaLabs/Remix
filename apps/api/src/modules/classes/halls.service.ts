import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { schema, withTenant, type Db } from '@remix/db';
import type { API, Hall } from '@remix/types/api';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { AppException } from '../../common/errors/app-exception';
import { CLOCK, type Clock } from '../../common/time/clock';
import type { EndpointBody } from '../../common/validation/endpoint';
import { AuditService } from '../audit/audit.service';
import { DB } from '../db/db.module';
import { isUniqueViolation, pgErrorCode } from '../people/scope';
import { actor } from './class-support';

const { halls } = schema;

type HallBody = EndpointBody<typeof API.createHall>;

const nameTaken = () =>
  new AppException('CONFLICT', 409, 'A hall with this name already exists', {
    errors: [{ path: 'name', message: 'A hall with this name already exists' }],
  });
const hallNotFound = () => new AppException('NOT_FOUND', 404, 'Hall not found');

/** Postgres `foreign_key_violation` / `restrict_violation`: a class still points at the hall. */
const isInUse = (error: unknown) => ['23503', '23001'].includes(pgErrorCode(error) ?? '');

/** CLS-05 — the rooms an institute teaches in. Names are unique per institute, ignoring case. */
@Injectable()
export class HallsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<{ items: Hall[] }> {
    const items = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select({ id: halls.id, name: halls.name, capacity: halls.capacity })
        .from(halls)
        .orderBy(asc(halls.name), asc(halls.id)),
    );
    return { items };
  }

  create(tenantId: string, session: AuthSession, body: HallBody): Promise<Hall> {
    const now = this.clock.now();
    return withTenant(this.db, tenantId, async (tx) => {
      try {
        const [row] = await tx
          .insert(halls)
          .values({ tenantId, name: body.name, capacity: body.capacity })
          .returning({ id: halls.id, name: halls.name, capacity: halls.capacity });
        if (!row) throw new Error('hall not created');
        await this.audit.record(tx, tenantId, {
          ...actor(session, now),
          action: 'hall.create',
          entity: 'hall',
          entityId: row.id,
          after: { name: row.name, capacity: row.capacity },
        });
        return row;
      } catch (error) {
        if (isUniqueViolation(error)) throw nameTaken();
        throw error;
      }
    });
  }

  update(tenantId: string, session: AuthSession, id: string, body: HallBody): Promise<Hall> {
    const now = this.clock.now();
    return withTenant(this.db, tenantId, async (tx) => {
      const [before] = await tx
        .select({ name: halls.name, capacity: halls.capacity })
        .from(halls)
        .where(eq(halls.id, id));
      if (!before) throw hallNotFound();
      try {
        const [row] = await tx
          .update(halls)
          .set({ name: body.name, capacity: body.capacity })
          .where(eq(halls.id, id))
          .returning({ id: halls.id, name: halls.name, capacity: halls.capacity });
        if (!row) throw hallNotFound();
        await this.audit.record(tx, tenantId, {
          ...actor(session, now),
          action: 'hall.update',
          entity: 'hall',
          entityId: id,
          before,
          after: { name: row.name, capacity: row.capacity },
        });
        return row;
      } catch (error) {
        if (isUniqueViolation(error)) throw nameTaken();
        throw error;
      }
    });
  }

  /** 409 CONFLICT while any class (archived ones included) still uses the hall. */
  delete(tenantId: string, session: AuthSession, id: string): Promise<undefined> {
    const now = this.clock.now();
    return withTenant(this.db, tenantId, async (tx) => {
      try {
        const [row] = await tx
          .delete(halls)
          .where(eq(halls.id, id))
          .returning({ id: halls.id, name: halls.name });
        if (!row) throw hallNotFound();
        await this.audit.record(tx, tenantId, {
          ...actor(session, now),
          action: 'hall.delete',
          entity: 'hall',
          entityId: id,
          before: { name: row.name },
        });
        return undefined;
      } catch (error) {
        if (isInUse(error)) {
          throw new AppException('CONFLICT', 409, 'This hall is still used by a class', {
            detail: 'Move its classes to another hall first.',
          });
        }
        throw error;
      }
    });
  }
}
