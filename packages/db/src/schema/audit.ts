import { sql } from 'drizzle-orm';
import { check, index, inet, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { id, instant, tenantId } from './columns';
import { actorKind } from './enums';
import { tenants } from './tenants';

/**
 * Append-only audit trail for money, role and settings changes. The app role has INSERT and
 * SELECT only (migrations/0002), so history cannot be rewritten through the API. No
 * `updated_at`: rows never change. `actor_id` has no FK so the trail outlives deleted users.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id'),
    actorKind: actorKind('actor_kind').notNull(),
    impersonatedBy: uuid('impersonated_by'),
    /** Dotted verb, e.g. "tenant.create", "payment.reverse". */
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: inet('ip'),
    requestId: text('request_id'),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('audit_logs_tenant_id_id_key').on(t.tenantId, t.id),
    index('audit_logs_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('audit_logs_tenant_entity_idx').on(t.tenantId, t.entity, t.entityId),
    check('audit_logs_action_format', sql`${t.action} ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'`),
    check('audit_logs_entity_length', sql`char_length(${t.entity}) BETWEEN 1 AND 64`),
    check('audit_logs_request_id_length', sql`char_length(${t.requestId}) <= 128`),
  ],
);
