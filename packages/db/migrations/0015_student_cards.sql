CREATE TYPE "public"."card_format" AS ENUM('barcode', 'qr', 'nfc');--> statement-breakpoint
CREATE TYPE "public"."card_source" AS ENUM('issued', 'linked');--> statement-breakpoint
CREATE TYPE "public"."card_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "student_cards" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"code" text NOT NULL,
	"format" "card_format" NOT NULL,
	"source" "card_source" NOT NULL,
	"status" "card_status" DEFAULT 'active' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	CONSTRAINT "student_cards_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "student_cards_tenant_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "student_cards_code_format" CHECK ("student_cards"."code" ~ '^[A-Z0-9]{4,64}$'),
	CONSTRAINT "student_cards_revocation" CHECK (("student_cards"."status" = 'active' AND "student_cards"."revoked_at" IS NULL AND "student_cards"."revoked_by" IS NULL AND "student_cards"."revoke_reason" IS NULL) OR ("student_cards"."status" = 'revoked' AND "student_cards"."revoked_at" IS NOT NULL AND "student_cards"."revoked_by" IS NOT NULL AND "student_cards"."revoke_reason" IS NOT NULL AND char_length(btrim("student_cards"."revoke_reason")) BETWEEN 3 AND 200))
);
--> statement-breakpoint
ALTER TABLE "student_cards" ADD CONSTRAINT "student_cards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_cards" ADD CONSTRAINT "student_cards_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_cards" ADD CONSTRAINT "student_cards_issued_by_fk" FOREIGN KEY ("tenant_id","issued_by") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_cards" ADD CONSTRAINT "student_cards_revoked_by_fk" FOREIGN KEY ("tenant_id","revoked_by") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "student_cards_tenant_active_key" ON "student_cards" USING btree ("tenant_id","student_id") WHERE "student_cards"."status" = 'active';--> statement-breakpoint
CREATE INDEX "student_cards_tenant_student_issued_idx" ON "student_cards" USING btree ("tenant_id","student_id","issued_at");