CREATE TYPE "public"."card_format" AS ENUM('barcode', 'qr', 'nfc');--> statement-breakpoint
CREATE TYPE "public"."card_kind" AS ENUM('permanent', 'temporary');--> statement-breakpoint
CREATE TYPE "public"."card_status" AS ENUM('ordered', 'active', 'revoked');--> statement-breakpoint
CREATE TABLE "student_cards" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"card_seq" integer NOT NULL,
	"code" text NOT NULL,
	"kind" "card_kind" NOT NULL,
	"formats" "card_format"[] NOT NULL,
	"nfc_uid" text,
	"status" "card_status" NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" uuid NOT NULL,
	"activated_at" timestamp with time zone,
	"activated_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	CONSTRAINT "student_cards_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "student_cards_tenant_seq_key" UNIQUE("tenant_id","student_id","card_seq"),
	CONSTRAINT "student_cards_tenant_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "student_cards_tenant_nfc_key" UNIQUE("tenant_id","nfc_uid"),
	CONSTRAINT "student_cards_seq_positive" CHECK ("student_cards"."card_seq" >= 1),
	CONSTRAINT "student_cards_code_length" CHECK (char_length("student_cards"."code") BETWEEN 3 AND 64),
	CONSTRAINT "student_cards_formats" CHECK (array_position("student_cards"."formats", NULL) IS NULL AND 'barcode' = ANY("student_cards"."formats") AND cardinality("student_cards"."formats") = (('barcode' = ANY("student_cards"."formats"))::int + ('qr' = ANY("student_cards"."formats"))::int + ('nfc' = ANY("student_cards"."formats"))::int)),
	CONSTRAINT "student_cards_temporary" CHECK ("student_cards"."kind" <> 'temporary' OR ("student_cards"."formats" = ARRAY['barcode']::card_format[] AND "student_cards"."status" <> 'ordered')),
	CONSTRAINT "student_cards_nfc" CHECK ("student_cards"."nfc_uid" IS NULL OR ("student_cards"."nfc_uid" ~ '^[0-9A-F]{8,20}$' AND 'nfc' = ANY("student_cards"."formats"))),
	CONSTRAINT "student_cards_activation" CHECK (("student_cards"."activated_at" IS NULL) = ("student_cards"."activated_by" IS NULL) AND ("student_cards"."status" <> 'active' OR "student_cards"."activated_at" IS NOT NULL) AND ("student_cards"."status" <> 'ordered' OR "student_cards"."activated_at" IS NULL)),
	CONSTRAINT "student_cards_revocation" CHECK (("student_cards"."status" <> 'revoked' AND "student_cards"."revoked_at" IS NULL AND "student_cards"."revoked_by" IS NULL AND "student_cards"."revoke_reason" IS NULL) OR ("student_cards"."status" = 'revoked' AND "student_cards"."revoked_at" IS NOT NULL AND "student_cards"."revoked_by" IS NOT NULL AND "student_cards"."revoke_reason" IS NOT NULL AND char_length(btrim("student_cards"."revoke_reason")) BETWEEN 3 AND 200))
);
--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT "tenants_student_no_prefix_format";--> statement-breakpoint
ALTER TABLE "student_cards" ADD CONSTRAINT "student_cards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_cards" ADD CONSTRAINT "student_cards_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_cards" ADD CONSTRAINT "student_cards_issued_by_fk" FOREIGN KEY ("tenant_id","issued_by") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_cards" ADD CONSTRAINT "student_cards_activated_by_fk" FOREIGN KEY ("tenant_id","activated_by") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_cards" ADD CONSTRAINT "student_cards_revoked_by_fk" FOREIGN KEY ("tenant_id","revoked_by") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "student_cards_tenant_active_key" ON "student_cards" USING btree ("tenant_id","student_id") WHERE "student_cards"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "student_cards_tenant_ordered_key" ON "student_cards" USING btree ("tenant_id","student_id") WHERE "student_cards"."status" = 'ordered';--> statement-breakpoint
CREATE INDEX "student_cards_tenant_student_issued_idx" ON "student_cards" USING btree ("tenant_id","student_id","issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_student_no_prefix_key" ON "tenants" USING btree ("student_no_prefix");--> statement-breakpoint
-- Pre-launch: existing duplicates must fail migration rather than silently renumber students.
CREATE UNIQUE INDEX "students_tenant_student_no_normal_key" ON "students" ("tenant_id", upper(regexp_replace(student_no, '\s', '', 'g')));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_student_no_prefix_format" CHECK ("tenants"."student_no_prefix" ~ '^[A-Z]{2,4}$');
