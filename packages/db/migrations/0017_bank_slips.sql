CREATE TYPE "public"."slip_status" AS ENUM('processing', 'submitted', 'approved', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."upload_kind" AS ENUM('slip');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('pending', 'processed', 'rejected');--> statement-breakpoint
CREATE TABLE "bank_slip_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slip_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	CONSTRAINT "bank_slip_lines_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "bank_slip_lines_tenant_slip_line_key" UNIQUE("tenant_id","slip_id","invoice_line_id")
);
--> statement-breakpoint
CREATE TABLE "bank_slips" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"status" "slip_status" DEFAULT 'processing' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"reference" text NOT NULL,
	"reference_norm" text NOT NULL,
	"slip_date" date NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"reject_reason" text,
	"payment_id" uuid,
	"duplicate_confirmed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "bank_slips_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "bank_slips_tenant_upload_key" UNIQUE("tenant_id","upload_id"),
	CONSTRAINT "bank_slips_tenant_payment_key" UNIQUE("tenant_id","payment_id"),
	CONSTRAINT "bank_slips_amount_safe" CHECK ("bank_slips"."amount_cents" between 1 and 9007199254740991),
	CONSTRAINT "bank_slips_reference_length" CHECK (char_length("bank_slips"."reference") between 3 and 40),
	CONSTRAINT "bank_slips_reference_norm" CHECK ("bank_slips"."reference_norm" = upper(regexp_replace("bank_slips"."reference", '\s', '', 'g'))),
	CONSTRAINT "bank_slips_review_state" CHECK (("bank_slips"."status" = 'approved') = ("bank_slips"."payment_id" is not null)
        and ("bank_slips"."status" = 'rejected') = ("bank_slips"."reject_reason" is not null)
        and ("bank_slips"."reject_reason" is null or char_length("bank_slips"."reject_reason") between 3 and 200)
        and ("bank_slips"."reviewed_by" is null or "bank_slips"."reviewed_at" is not null)
        and ("bank_slips"."status" not in ('approved', 'rejected') or "bank_slips"."reviewed_at" is not null)
        and ("bank_slips"."status" = 'approved' or not "bank_slips"."duplicate_confirmed"))
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "upload_kind" NOT NULL,
	"created_by" uuid NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"object_key" text NOT NULL,
	"processed_key" text,
	"status" "upload_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "uploads_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "uploads_tenant_object_key" UNIQUE("tenant_id","object_key"),
	CONSTRAINT "uploads_content_type" CHECK ("uploads"."content_type" in ('image/jpeg', 'image/png', 'image/heic', 'image/heif')),
	CONSTRAINT "uploads_size" CHECK ("uploads"."size_bytes" between 1 and 5242880),
	CONSTRAINT "uploads_object_tenant_prefix" CHECK ("uploads"."object_key" like "uploads"."tenant_id"::text || '/%'),
	CONSTRAINT "uploads_processed_tenant_prefix" CHECK ("uploads"."processed_key" is null or "uploads"."processed_key" like "uploads"."tenant_id"::text || '/%'),
	CONSTRAINT "uploads_processed_state" CHECK (("uploads"."status" = 'processed') = ("uploads"."processed_key" is not null)
        and ("uploads"."status" = 'pending') = ("uploads"."processed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "bank_slip_lines" ADD CONSTRAINT "bank_slip_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_slip_lines" ADD CONSTRAINT "bank_slip_lines_slip_fk" FOREIGN KEY ("tenant_id","slip_id") REFERENCES "public"."bank_slips"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_slip_lines" ADD CONSTRAINT "bank_slip_lines_line_fk" FOREIGN KEY ("tenant_id","invoice_line_id") REFERENCES "public"."invoice_lines"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_slips" ADD CONSTRAINT "bank_slips_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_slips" ADD CONSTRAINT "bank_slips_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_slips" ADD CONSTRAINT "bank_slips_upload_fk" FOREIGN KEY ("tenant_id","upload_id") REFERENCES "public"."uploads"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_slips" ADD CONSTRAINT "bank_slips_reviewed_by_fk" FOREIGN KEY ("tenant_id","reviewed_by") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_slips" ADD CONSTRAINT "bank_slips_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_slip_lines_tenant_line_idx" ON "bank_slip_lines" USING btree ("tenant_id","invoice_line_id");--> statement-breakpoint
CREATE INDEX "bank_slips_tenant_status_submitted_idx" ON "bank_slips" USING btree ("tenant_id","status","submitted_at");--> statement-breakpoint
CREATE INDEX "bank_slips_tenant_student_submitted_idx" ON "bank_slips" USING btree ("tenant_id","student_id","submitted_at");--> statement-breakpoint
CREATE INDEX "bank_slips_tenant_reference_idx" ON "bank_slips" USING btree ("tenant_id","reference_norm","amount_cents");--> statement-breakpoint
CREATE INDEX "uploads_tenant_status_created_idx" ON "uploads" USING btree ("tenant_id","status","created_at");
