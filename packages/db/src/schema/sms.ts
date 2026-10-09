import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, instant, tenantId, timestamps } from './columns';
import { tenants } from './tenants';
import { tenantUsers } from './users';

const cents = (name: string) => bigint(name, { mode: 'number' });

/** Ledger kinds; the sign of `amount_cents` is fixed per kind (see the table checks). */
export const SMS_LEDGER_KIND_VALUES = ['top_up', 'send', 'refund', 'adjustment'] as const;
export const SMS_MESSAGE_STATUS_VALUES = ['pending', 'queued', 'sent', 'failed'] as const;
export const SMS_TOP_UP_STATUS_VALUES = ['requested', 'credited', 'cancelled'] as const;

const literalList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * MSG-02: one prepaid SMS wallet per tenant (created lazily on first use). `balance_cents` is a
 * projection of `sms_wallet_ledger`: the ledger trigger is the only thing allowed to change it
 * (a guard trigger rejects direct updates), and a CHECK keeps it from ever going negative.
 */
export const smsWallets = pgTable(
  'sms_wallets',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    balanceCents: cents('balance_cents').notNull().default(0),
    /** Registered sender mask overriding the platform default (set by Recca staff). */
    senderId: text('sender_id'),
    lowBalanceThresholdCents: cents('low_balance_threshold_cents').notNull().default(20_000),
    /** Set when the balance first drops under the threshold; cleared by the next top-up. */
    lowBalanceAlertedAt: instant('low_balance_alerted_at'),
    ...timestamps(),
  },
  (t) => [
    unique('sms_wallets_tenant_id_id_key').on(t.tenantId, t.id),
    unique('sms_wallets_tenant_key').on(t.tenantId),
    check('sms_wallets_balance_safe', sql`${t.balanceCents} between 0 and 9007199254740991`),
    check('sms_wallets_threshold_safe', sql`${t.lowBalanceThresholdCents} between 0 and 100000000`),
    check('sms_wallets_sender_id', sql`${t.senderId} is null or ${t.senderId} ~ '^[A-Za-z0-9]{3,11}$'`),
  ],
);

/**
 * What the wallet is charged for: one row per outbound system SMS, keyed by the business
 * `message_id` (also the `sms` job id and the provider idempotency key). The unique key makes
 * every sender idempotent: reminders for the same student/month/kind, a receipt for the same
 * payment, or a retried API request produce one row, one debit and one SMS. Holds no phone
 * number and no text.
 */
export const smsMessages = pgTable(
  'sms_messages',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull(),
    template: text('template').notNull(),
    segments: integer('segments').notNull(),
    costCents: cents('cost_cents').notNull(),
    /** pending = debited, not yet queued; queued -> sent | failed (failed is refunded). */
    status: text('status').notNull().default('pending'),
    ...timestamps(),
  },
  (t) => [
    unique('sms_messages_tenant_id_id_key').on(t.tenantId, t.id),
    unique('sms_messages_tenant_message_key').on(t.tenantId, t.messageId),
    index('sms_messages_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
    check('sms_messages_message_id', sql`${t.messageId} ~ '^[A-Za-z0-9_-]{1,100}$'`),
    check('sms_messages_template', sql`${t.template} ~ '^[a-z][a-z0-9_.]{0,39}$'`),
    check('sms_messages_segments', sql`${t.segments} between 1 and 20`),
    check('sms_messages_cost', sql`${t.costCents} between 0 and 100000000`),
    check('sms_messages_status', sql`${t.status} in (${literalList(SMS_MESSAGE_STATUS_VALUES)})`),
  ],
);

/**
 * Append-only wallet ledger. `amount_cents` is signed (send < 0, top_up/refund > 0);
 * `balance_after_cents` is filled in by the BEFORE INSERT trigger that also locks the wallet row
 * and rejects any entry that would take the balance below zero. The app role may only insert
 * `send` and `refund` rows (RLS WITH CHECK); credits come from staff tooling as the owner role.
 */
export const smsWalletLedger = pgTable(
  'sms_wallet_ledger',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    amountCents: cents('amount_cents').notNull(),
    balanceAfterCents: cents('balance_after_cents').notNull().default(0),
    messageId: text('message_id'),
    segments: integer('segments'),
    note: text('note'),
    actorId: uuid('actor_id'),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('sms_wallet_ledger_tenant_id_id_key').on(t.tenantId, t.id),
    unique('sms_wallet_ledger_tenant_message_kind_key').on(t.tenantId, t.messageId, t.kind),
    index('sms_wallet_ledger_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    foreignKey({
      name: 'sms_wallet_ledger_message_fk',
      columns: [t.tenantId, t.messageId],
      foreignColumns: [smsMessages.tenantId, smsMessages.messageId],
    }),
    foreignKey({
      name: 'sms_wallet_ledger_actor_fk',
      columns: [t.tenantId, t.actorId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    check('sms_wallet_ledger_kind', sql`${t.kind} in (${literalList(SMS_LEDGER_KIND_VALUES)})`),
    check(
      'sms_wallet_ledger_sign',
      sql`(${t.kind} = 'top_up' and ${t.amountCents} > 0) or (${t.kind} = 'send' and ${t.amountCents} < 0)
        or (${t.kind} = 'refund' and ${t.amountCents} > 0) or (${t.kind} = 'adjustment' and ${t.amountCents} <> 0)`,
    ),
    check('sms_wallet_ledger_amount_safe', sql`abs(${t.amountCents}) <= 100000000000`),
    check('sms_wallet_ledger_message', sql`(${t.kind} in ('send', 'refund')) = (${t.messageId} is not null)`),
    check('sms_wallet_ledger_adjustment_note', sql`${t.kind} <> 'adjustment' or coalesce(char_length(btrim(${t.note})), 0) >= 3`),
    check('sms_wallet_ledger_note_length', sql`char_length(${t.note}) <= 200`),
  ],
);

/** "Buy SMS" requests: Recca staff invoice the institute offline, then credit via the CLI. */
export const smsTopUpRequests = pgTable(
  'sms_top_up_requests',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    amountCents: cents('amount_cents').notNull(),
    requestedBy: uuid('requested_by').notNull(),
    status: text('status').notNull().default('requested'),
    createdAt: instant('created_at').notNull().defaultNow(),
    resolvedAt: instant('resolved_at'),
  },
  (t) => [
    unique('sms_top_up_requests_tenant_id_id_key').on(t.tenantId, t.id),
    index('sms_top_up_requests_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    foreignKey({
      name: 'sms_top_up_requests_requested_by_fk',
      columns: [t.tenantId, t.requestedBy],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    check('sms_top_up_requests_amount', sql`${t.amountCents} between 100000 and 100000000`),
    check('sms_top_up_requests_status', sql`${t.status} in (${literalList(SMS_TOP_UP_STATUS_VALUES)})`),
  ],
);
