CREATE TYPE "public"."integration_kind" AS ENUM('payhere', 'sms', 'zoom');--> statement-breakpoint
CREATE TABLE "tenant_integrations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "integration_kind" NOT NULL,
	"config" jsonb NOT NULL,
	"secret_ciphertext" "bytea",
	"secret_nonce" "bytea",
	"key_id" text,
	CONSTRAINT "tenant_integrations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "tenant_integrations_tenant_kind_key" UNIQUE("tenant_id","kind"),
	CONSTRAINT "tenant_integrations_secret_envelope" CHECK (("tenant_integrations"."secret_ciphertext" is null and "tenant_integrations"."secret_nonce" is null and "tenant_integrations"."key_id" is null)
    or ("tenant_integrations"."secret_ciphertext" is not null and octet_length("tenant_integrations"."secret_ciphertext") >= 16 and "tenant_integrations"."secret_nonce" is not null and octet_length("tenant_integrations"."secret_nonce") = 12 and "tenant_integrations"."key_id" is not null and char_length("tenant_integrations"."key_id") between 1 and 64)),
	CONSTRAINT "tenant_integrations_config_object" CHECK (jsonb_typeof("tenant_integrations"."config") = 'object')
);
--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "reminders_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "remind_before_days" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "remind_after_days" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "bank_details" jsonb;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "receipt_address" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "receipt_phone" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "receipt_footer" text;--> statement-breakpoint
ALTER TABLE "tenant_integrations" ADD CONSTRAINT "tenant_integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_remind_before_range" CHECK ("tenant_settings"."remind_before_days" between 0 and 10);--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_remind_after_range" CHECK ("tenant_settings"."remind_after_days" between 1 and 30);--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_receipt_lengths" CHECK (char_length("tenant_settings"."receipt_address") <= 200 and char_length("tenant_settings"."receipt_phone") <= 40 and char_length("tenant_settings"."receipt_footer") <= 200);--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_bank_details" CHECK ("tenant_settings"."bank_details" is null or coalesce(jsonb_typeof("tenant_settings"."bank_details") = 'object'
    and "tenant_settings"."bank_details" ?& array['bankName', 'branch', 'accountNumber', 'accountName']
    and ("tenant_settings"."bank_details" - array['bankName', 'branch', 'accountNumber', 'accountName']) = '{}'::jsonb
    and jsonb_typeof("tenant_settings"."bank_details"->'bankName') = 'string' and char_length(btrim("tenant_settings"."bank_details"->>'bankName')) between 2 and 80
    and jsonb_typeof("tenant_settings"."bank_details"->'branch') = 'string' and char_length(btrim("tenant_settings"."bank_details"->>'branch')) between 2 and 80
    and jsonb_typeof("tenant_settings"."bank_details"->'accountName') = 'string' and char_length(btrim("tenant_settings"."bank_details"->>'accountName')) between 2 and 120
    and jsonb_typeof("tenant_settings"."bank_details"->'accountNumber') = 'string' and btrim("tenant_settings"."bank_details"->>'accountNumber') ~ '^[0-9 -]{6,24}$', false));