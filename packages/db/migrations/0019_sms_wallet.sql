CREATE TABLE "sms_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"template" text NOT NULL,
	"segments" integer NOT NULL,
	"cost_cents" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_messages_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "sms_messages_tenant_message_key" UNIQUE("tenant_id","message_id"),
	CONSTRAINT "sms_messages_message_id" CHECK ("sms_messages"."message_id" ~ '^[A-Za-z0-9_-]{1,100}$'),
	CONSTRAINT "sms_messages_template" CHECK ("sms_messages"."template" ~ '^[a-z][a-z0-9_.]{0,39}$'),
	CONSTRAINT "sms_messages_segments" CHECK ("sms_messages"."segments" between 1 and 20),
	CONSTRAINT "sms_messages_cost" CHECK ("sms_messages"."cost_cents" between 0 and 100000000),
	CONSTRAINT "sms_messages_status" CHECK ("sms_messages"."status" in ('pending', 'queued', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "sms_top_up_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "sms_top_up_requests_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "sms_top_up_requests_amount" CHECK ("sms_top_up_requests"."amount_cents" between 100000 and 100000000),
	CONSTRAINT "sms_top_up_requests_status" CHECK ("sms_top_up_requests"."status" in ('requested', 'credited', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "sms_wallet_ledger" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"balance_after_cents" bigint DEFAULT 0 NOT NULL,
	"message_id" text,
	"segments" integer,
	"note" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_wallet_ledger_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "sms_wallet_ledger_tenant_message_kind_key" UNIQUE("tenant_id","message_id","kind"),
	CONSTRAINT "sms_wallet_ledger_kind" CHECK ("sms_wallet_ledger"."kind" in ('top_up', 'send', 'refund', 'adjustment')),
	CONSTRAINT "sms_wallet_ledger_sign" CHECK (("sms_wallet_ledger"."kind" = 'top_up' and "sms_wallet_ledger"."amount_cents" > 0) or ("sms_wallet_ledger"."kind" = 'send' and "sms_wallet_ledger"."amount_cents" < 0)
        or ("sms_wallet_ledger"."kind" = 'refund' and "sms_wallet_ledger"."amount_cents" > 0) or ("sms_wallet_ledger"."kind" = 'adjustment' and "sms_wallet_ledger"."amount_cents" <> 0)),
	CONSTRAINT "sms_wallet_ledger_amount_safe" CHECK (abs("sms_wallet_ledger"."amount_cents") <= 100000000000),
	CONSTRAINT "sms_wallet_ledger_message" CHECK (("sms_wallet_ledger"."kind" in ('send', 'refund')) = ("sms_wallet_ledger"."message_id" is not null)),
	CONSTRAINT "sms_wallet_ledger_adjustment_note" CHECK ("sms_wallet_ledger"."kind" <> 'adjustment' or coalesce(char_length(btrim("sms_wallet_ledger"."note")), 0) >= 3),
	CONSTRAINT "sms_wallet_ledger_note_length" CHECK (char_length("sms_wallet_ledger"."note") <= 200)
);
--> statement-breakpoint
CREATE TABLE "sms_wallets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"balance_cents" bigint DEFAULT 0 NOT NULL,
	"sender_id" text,
	"low_balance_threshold_cents" bigint DEFAULT 20000 NOT NULL,
	"low_balance_alerted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_wallets_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "sms_wallets_tenant_key" UNIQUE("tenant_id"),
	CONSTRAINT "sms_wallets_balance_safe" CHECK ("sms_wallets"."balance_cents" between 0 and 9007199254740991),
	CONSTRAINT "sms_wallets_threshold_safe" CHECK ("sms_wallets"."low_balance_threshold_cents" between 0 and 100000000),
	CONSTRAINT "sms_wallets_sender_id" CHECK ("sms_wallets"."sender_id" is null or "sms_wallets"."sender_id" ~ '^[A-Za-z0-9]{3,11}$')
);
--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "receipt_sms_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_top_up_requests" ADD CONSTRAINT "sms_top_up_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_top_up_requests" ADD CONSTRAINT "sms_top_up_requests_requested_by_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_wallet_ledger" ADD CONSTRAINT "sms_wallet_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_wallet_ledger" ADD CONSTRAINT "sms_wallet_ledger_message_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."sms_messages"("tenant_id","message_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_wallet_ledger" ADD CONSTRAINT "sms_wallet_ledger_actor_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_wallets" ADD CONSTRAINT "sms_wallets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sms_messages_tenant_status_idx" ON "sms_messages" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "sms_top_up_requests_tenant_created_idx" ON "sms_top_up_requests" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sms_wallet_ledger_tenant_created_idx" ON "sms_wallet_ledger" USING btree ("tenant_id","created_at" DESC NULLS LAST);