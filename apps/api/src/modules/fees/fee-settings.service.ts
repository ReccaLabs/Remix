import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema, withTenant, type Db } from '@remix/db';
import type { FeeSettings, UpdateFeeSettingsRequest } from '@remix/types/api';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { CLOCK, type Clock } from '../../common/time/clock';
import { AuditService, maskIdentifier } from '../audit/audit.service';
import { actor } from '../classes/class-support';
import { DB } from '../db/db.module';
import { lockMoneySettings } from './payhere-settings.service';

const { tenantSettings } = schema;
export function feeSettingsView(row?: typeof tenantSettings.$inferSelect): FeeSettings {
  return {
    dueDay: row?.dueDay ?? 5,
    remindersEnabled: row?.remindersEnabled ?? false,
    remindBeforeDays: row?.remindBeforeDays ?? 0,
    remindAfterDays: row?.remindAfterDays ?? 1,
    bankDetails: row?.bankDetails ?? null,
    receipt: {
      address: row?.receiptAddress ?? null,
      phone: row?.receiptPhone ?? null,
      footer: row?.receiptFooter ?? null,
    },
  };
}
/** Bank account and contact numbers are useful to owners, but need not be copied into audits. */
function auditView(settings: FeeSettings) {
  return {
    ...settings,
    bankDetails: settings.bankDetails
      ? {
          ...settings.bankDetails,
          accountNumber: `••••${settings.bankDetails.accountNumber.slice(-4)}`,
        }
      : null,
    receipt: {
      ...settings.receipt,
      phone: settings.receipt.phone
        ? maskIdentifier({ kind: 'phone', phone: settings.receipt.phone })
        : null,
    },
  };
}

@Injectable()
export class FeeSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}
  get(tenantId: string): Promise<FeeSettings> {
    return withTenant(this.db, tenantId, async (tx) =>
      feeSettingsView((await tx.select().from(tenantSettings))[0]),
    );
  }
  update(
    tenantId: string,
    session: AuthSession,
    body: UpdateFeeSettingsRequest,
  ): Promise<FeeSettings> {
    return withTenant(this.db, tenantId, async (tx) => {
      await lockMoneySettings(tx, tenantId);
      await tx
        .insert(tenantSettings)
        .values({ tenantId })
        .onConflictDoNothing({ target: tenantSettings.tenantId });
      const before = feeSettingsView((await tx.select().from(tenantSettings))[0]);
      const changes: Partial<typeof tenantSettings.$inferInsert> = {};
      if (body.dueDay !== undefined) changes.dueDay = body.dueDay;
      if (body.remindersEnabled !== undefined) changes.remindersEnabled = body.remindersEnabled;
      if (body.remindBeforeDays !== undefined) changes.remindBeforeDays = body.remindBeforeDays;
      if (body.remindAfterDays !== undefined) changes.remindAfterDays = body.remindAfterDays;
      if (body.bankDetails !== undefined) changes.bankDetails = body.bankDetails;
      if (body.receipt?.address !== undefined) changes.receiptAddress = body.receipt.address;
      if (body.receipt?.phone !== undefined) changes.receiptPhone = body.receipt.phone;
      if (body.receipt?.footer !== undefined) changes.receiptFooter = body.receipt.footer;
      if (!Object.keys(changes).length) return before;
      await tx.update(tenantSettings).set(changes).where(eq(tenantSettings.tenantId, tenantId));
      const after = feeSettingsView((await tx.select().from(tenantSettings))[0]);
      await this.audit.record(tx, tenantId, {
        ...actor(session, this.clock.now()),
        action: 'settings.fees_update',
        entity: 'tenant',
        entityId: tenantId,
        before: auditView(before),
        after: auditView(after),
      });
      return after;
    });
  }
}
