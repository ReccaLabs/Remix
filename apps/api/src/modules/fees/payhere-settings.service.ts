import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { schema, withTenant, type Db, type Tx } from '@remix/db';
import type { PayhereSettings, UpdatePayhereSettingsRequest } from '@remix/types/api';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { AppException } from '../../common/errors/app-exception';
import { CLOCK, type Clock } from '../../common/time/clock';
import { PayhereCheckoutBuilder } from '../../integrations/payment/payhere-checkout-builder';
import { SecretBox, type SecretEnvelope } from '../../integrations/secret-box';
import { AuditService } from '../audit/audit.service';
import { actor } from '../classes/class-support';
import { DB } from '../db/db.module';
import { feeNotFound } from './ledger';

const { tenantIntegrations, tenants, tenantUsers, tenantSettings } = schema;
const defaults = (): (typeof tenantIntegrations.$inferInsert)['config'] => ({
  enabled: false,
  mode: 'sandbox',
  merchantId: null,
  lastTest: null,
});

/** Serialize singleton creation and read/modify/write settings patches within the tenant. */
export async function lockMoneySettings(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${tenantId} || ':money-settings', 0))`,
  );
}

@Injectable()
export class PayhereSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly secrets: SecretBox,
    private readonly builder: PayhereCheckoutBuilder,
    private readonly audit: AuditService,
  ) {}

  get(tenantId: string): Promise<PayhereSettings> {
    return withTenant(this.db, tenantId, (tx) => this.read(tx, tenantId));
  }

  update(
    tenantId: string,
    session: AuthSession,
    body: UpdatePayhereSettingsRequest,
  ): Promise<PayhereSettings> {
    return withTenant(this.db, tenantId, async (tx) => {
      await lockMoneySettings(tx, tenantId);
      const before = await this.row(tx);
      if (!Object.keys(body).length) return this.read(tx, tenantId);
      const config = { ...(before?.config ?? defaults()) };
      if (body.enabled !== undefined) config.enabled = body.enabled;
      if (body.mode !== undefined) config.mode = body.mode;
      if (body.merchantId !== undefined) config.merchantId = body.merchantId;
      const envelope: Partial<SecretEnvelope> =
        body.merchantSecret === undefined ? {} : this.secrets.seal(tenantId, body.merchantSecret);
      if (
        config.enabled &&
        (!config.merchantId || (!body.merchantSecret && !before?.secretCiphertext))
      ) {
        throw new AppException(
          'VALIDATION_FAILED',
          400,
          'Set the merchant ID and secret before enabling PayHere',
        );
      }
      const values = { config, ...envelope };
      if (before)
        await tx.update(tenantIntegrations).set(values).where(eq(tenantIntegrations.id, before.id));
      // Drizzle includes `id DEFAULT` in INSERT, which needs an id-column INSERT grant.
      // Keep identity ungrantable by naming only the allowed columns in this parameterized insert.
      else
        await tx.execute(sql`insert into tenant_integrations (tenant_id, kind, config, secret_ciphertext, secret_nonce, key_id)
        values (${tenantId}, 'payhere', ${JSON.stringify(config)}::jsonb,
          ${envelope.secretCiphertext ?? null}, ${envelope.secretNonce ?? null}, ${envelope.keyId ?? null})`);
      // No secret, envelope, or hint in audit rows; changing a secret is represented by a boolean.
      await this.audit.record(tx, tenantId, {
        ...actor(session, this.clock.now()),
        action: 'settings.payhere_update',
        entity: 'tenant',
        entityId: tenantId,
        before: { ...(before?.config ?? defaults()) },
        after: { ...config, secretChanged: body.merchantSecret !== undefined },
      });
      return this.read(tx, tenantId);
    });
  }

  test(tenantId: string, session: AuthSession, origin: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      await lockMoneySettings(tx, tenantId);
      const row = await this.row(tx);
      if (!row?.config.merchantId || !row.secretCiphertext || !row.secretNonce || !row.keyId)
        throw new AppException(
          'VALIDATION_FAILED',
          400,
          'Set the merchant ID and secret before testing',
        );
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
      const [owner] = await tx.select().from(tenantUsers).where(eq(tenantUsers.id, session.userId));
      const [settings] = await tx.select().from(tenantSettings);
      if (!tenant || !owner) throw feeNotFound();
      if (!owner.email || !owner.phone) {
        throw new AppException(
          'VALIDATION_FAILED',
          400,
          'Add an email and phone to your profile before testing PayHere',
        );
      }
      const [firstName = '', ...rest] = owner.displayName.split(' ');
      const checkout = this.builder.build({
        merchantId: row.config.merchantId,
        merchantSecret: this.secrets.open(tenantId, {
          secretCiphertext: row.secretCiphertext,
          secretNonce: row.secretNonce,
          keyId: row.keyId,
        }),
        mode: row.config.mode,
        orderId: randomUUID(),
        amountCents: 1000,
        origin,
        tenantSlug: tenant.slug,
        customer: {
          firstName,
          lastName: rest.join(' ') || 'Integration test',
          email: owner.email,
          phone: owner.phone,
          // Required gateway fields for an owner-only integration test, with no delivery.
          // Real student billing/customer data belongs to the 3-E checkout flow.
          address: settings?.receiptAddress?.trim() || 'Integration test - no delivery',
          city: 'Not applicable (integration test)',
        },
      });
      // TODO(3-E): persist an owner-test checkout and verify notify; redirects never prove payment.
      // This row deliberately stays pending until the verified callback flow is implemented.
      const config = {
        ...row.config,
        lastTest: { at: this.clock.now().toISOString(), status: 'pending' as const },
      };
      await tx.update(tenantIntegrations).set({ config }).where(eq(tenantIntegrations.id, row.id));
      await this.audit.record(tx, tenantId, {
        ...actor(session, this.clock.now()),
        action: 'settings.payhere_test',
        entity: 'tenant',
        entityId: tenantId,
        after: { checkoutId: checkout.checkoutId, amountCents: 1000, mode: config.mode },
      });
      return checkout;
    });
  }

  private async row(tx: Tx) {
    const [row] = await tx
      .select()
      .from(tenantIntegrations)
      .where(eq(tenantIntegrations.kind, 'payhere'));
    return row;
  }
  private async read(tx: Tx, tenantId: string): Promise<PayhereSettings> {
    const row = await this.row(tx);
    let secretHint: string | null = null;
    if (row?.secretCiphertext && row.secretNonce && row.keyId) {
      secretHint = `••••${this.secrets.open(tenantId, { secretCiphertext: row.secretCiphertext, secretNonce: row.secretNonce, keyId: row.keyId }).slice(-4)}`;
    }
    return { ...(row?.config ?? defaults()), secretHint };
  }
}
