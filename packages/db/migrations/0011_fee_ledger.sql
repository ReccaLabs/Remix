CREATE TYPE "public"."invoice_status" AS ENUM('unpaid', 'partially_paid', 'paid', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('card', 'slip', 'cash', 'manual', 'reversal');--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"month" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_lines_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoice_lines_tenant_enrollment_month_key" UNIQUE("tenant_id","enrollment_id","month"),
	CONSTRAINT "invoice_lines_month_first_day" CHECK (extract(day from "invoice_lines"."month") = 1),
	CONSTRAINT "invoice_lines_amount_safe" CHECK ("invoice_lines"."amount_cents" between 0 and 100000000),
	CONSTRAINT "invoice_lines_void_reason" CHECK (("invoice_lines"."voided_at" is null and "invoice_lines"."void_reason" is null) or ("invoice_lines"."voided_at" is not null and char_length("invoice_lines"."void_reason") >= 3))
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"number" text NOT NULL,
	"month" date NOT NULL,
	"due_on" date NOT NULL,
	"status" "invoice_status" DEFAULT 'unpaid' NOT NULL,
	"paid_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoices_tenant_id_id_month_key" UNIQUE("tenant_id","id","month"),
	CONSTRAINT "invoices_tenant_student_month_key" UNIQUE("tenant_id","student_id","month"),
	CONSTRAINT "invoices_tenant_number_key" UNIQUE("tenant_id","number"),
	CONSTRAINT "invoices_month_first_day" CHECK (extract(day from "invoices"."month") = 1),
	CONSTRAINT "invoices_due_in_month" CHECK (date_trunc('month', "invoices"."due_on"::timestamp)::date = "invoices"."month"),
	CONSTRAINT "invoices_paid_safe" CHECK ("invoices"."paid_cents" between 0 and 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	CONSTRAINT "payment_allocations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_allocations_tenant_payment_line_key" UNIQUE("tenant_id","payment_id","invoice_line_id"),
	CONSTRAINT "payment_allocations_amount_safe" CHECK ("payment_allocations"."amount_cents" between -100000000 and 100000000 and "payment_allocations"."amount_cents" <> 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"unallocated_cents" bigint DEFAULT 0 NOT NULL,
	"needs_refund" boolean DEFAULT false NOT NULL,
	"received_by" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_ref" text,
	"note" text,
	"idempotency_key" text NOT NULL,
	"reverses_payment_id" uuid,
	CONSTRAINT "payments_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payments_tenant_idempotency_key" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "payments_tenant_reverses_key" UNIQUE("tenant_id","reverses_payment_id"),
	CONSTRAINT "payments_amount_safe" CHECK ("payments"."amount_cents" between -9007199254740991 and 9007199254740991),
	CONSTRAINT "payments_reversal_sign" CHECK (("payments"."method" = 'reversal' and "payments"."amount_cents" <= 0 and "payments"."reverses_payment_id" is not null and "payments"."reverses_payment_id" <> "payments"."id") or ("payments"."method" <> 'reversal' and "payments"."amount_cents" >= 0 and "payments"."reverses_payment_id" is null)),
	CONSTRAINT "payments_surplus_bounds" CHECK ("payments"."unallocated_cents" between 0 and abs("payments"."amount_cents") and ("payments"."method" in ('card', 'reversal') or "payments"."unallocated_cents" = 0)),
	CONSTRAINT "payments_refund_flag" CHECK ("payments"."needs_refund" = ("payments"."method" = 'card' and "payments"."unallocated_cents" > 0)),
	CONSTRAINT "payments_idempotency_length" CHECK (char_length("payments"."idempotency_key") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"number" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cash_received_cents" bigint,
	"reversed_at" timestamp with time zone,
	"pdf_key" text,
	CONSTRAINT "receipts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "receipts_tenant_payment_key" UNIQUE("tenant_id","payment_id"),
	CONSTRAINT "receipts_tenant_number_key" UNIQUE("tenant_id","number"),
	CONSTRAINT "receipts_cash_received_safe" CHECK ("receipts"."cash_received_cents" between 0 and 9007199254740991),
	CONSTRAINT "receipts_pdf_tenant_prefix" CHECK ("receipts"."pdf_key" like "receipts"."tenant_id"::text || '/%')
);
--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"due_day" smallint DEFAULT 5 NOT NULL,
	"unlock_before_due" boolean DEFAULT false NOT NULL,
	CONSTRAINT "tenant_settings_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "tenant_settings_tenant_key" UNIQUE("tenant_id"),
	CONSTRAINT "tenant_settings_due_day_range" CHECK ("tenant_settings"."due_day" between 1 and 28),
	CONSTRAINT "tenant_settings_no_grace_r1" CHECK (not "tenant_settings"."unlock_before_due")
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id","month") REFERENCES "public"."invoices"("tenant_id","id","month") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_enrollment_fk" FOREIGN KEY ("tenant_id","enrollment_id") REFERENCES "public"."enrollments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_class_fk" FOREIGN KEY ("tenant_id","class_id") REFERENCES "public"."classes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_line_fk" FOREIGN KEY ("tenant_id","invoice_line_id") REFERENCES "public"."invoice_lines"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_fk" FOREIGN KEY ("tenant_id","received_by") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reverses_fk" FOREIGN KEY ("tenant_id","reverses_payment_id") REFERENCES "public"."payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_lines_tenant_invoice_idx" ON "invoice_lines" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_tenant_month_idx" ON "invoices" USING btree ("tenant_id","month");--> statement-breakpoint
CREATE INDEX "payment_allocations_tenant_line_idx" ON "payment_allocations" USING btree ("tenant_id","invoice_line_id");--> statement-breakpoint
CREATE INDEX "payments_tenant_student_received_idx" ON "payments" USING btree ("tenant_id","student_id","received_at");