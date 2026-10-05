import { sql } from 'drizzle-orm';
import { check, customType, jsonb, pgEnum, pgTable, text, unique } from 'drizzle-orm/pg-core';
import type { PayhereSettings } from '@remix/types/api';
import { id, tenantId } from './columns';
import { tenants } from './tenants';

export const integrationKind = pgEnum('integration_kind', ['payhere', 'sms', 'zoom']);
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
export type PayhereConfig = Pick<PayhereSettings, 'merchantId' | 'mode' | 'enabled' | 'lastTest'>;

/** Secret ciphertext includes the 16-byte GCM tag; never put credentials in config. */
export const tenantIntegrations = pgTable('tenant_integrations', {
  id: id(), tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  kind: integrationKind('kind').notNull(),
  config: jsonb('config').$type<PayhereConfig>().notNull(),
  secretCiphertext: bytea('secret_ciphertext'), secretNonce: bytea('secret_nonce'), keyId: text('key_id'),
}, (t) => [
  unique('tenant_integrations_tenant_id_id_key').on(t.tenantId, t.id),
  unique('tenant_integrations_tenant_kind_key').on(t.tenantId, t.kind),
  check('tenant_integrations_secret_envelope', sql`(${t.secretCiphertext} is null and ${t.secretNonce} is null and ${t.keyId} is null)
    or (${t.secretCiphertext} is not null and octet_length(${t.secretCiphertext}) >= 16 and ${t.secretNonce} is not null and octet_length(${t.secretNonce}) = 12 and ${t.keyId} is not null and char_length(${t.keyId}) between 1 and 64)`),
  check('tenant_integrations_config_object', sql`jsonb_typeof(${t.config}) = 'object'`),
]);
