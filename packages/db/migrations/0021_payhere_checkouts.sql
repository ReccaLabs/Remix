CREATE TYPE "public"."checkout_kind" AS ENUM('fees', 'test');--> statement-breakpoint
CREATE TYPE "public"."checkout_status" AS ENUM('pending', 'paid', 'failed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "payhere_checkout_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"checkout_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	CONSTRAINT "payhere_checkout_lines_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payhere_checkout_lines_tenant_checkout_line_key" UNIQUE("tenant_id","checkout_id","invoice_line_id")
);
--> statement-breakpoint
CREATE TABLE "payhere_checkouts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "checkout_kind" NOT NULL,
	"student_id" uuid,
	"created_by" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'LKR' NOT NULL,
	"merchant_id" text NOT NULL,
	"mode" text NOT NULL,
	"status" "checkout_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status_code" smallint,
	"notified_at" timestamp with time zone,
	"provider_payment_id" text,
	"payment_id" uuid,
	"chargeback_at" timestamp with time zone,
	CONSTRAINT "payhere_checkouts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payhere_checkouts_tenant_payment_key" UNIQUE("tenant_id","payment_id"),
	CONSTRAINT "payhere_checkouts_amount_safe" CHECK ("payhere_checkouts"."amount_cents" between 1 and 9007199254740991),
	CONSTRAINT "payhere_checkouts_currency" CHECK ("payhere_checkouts"."currency" = 'LKR'),
	CONSTRAINT "payhere_checkouts_mode" CHECK ("payhere_checkouts"."mode" in ('sandbox', 'live')),
	CONSTRAINT "payhere_checkouts_merchant" CHECK ("payhere_checkouts"."merchant_id" ~ '^[0-9]{4,20}$'),
	CONSTRAINT "payhere_checkouts_expiry" CHECK ("payhere_checkouts"."expires_at" > "payhere_checkouts"."created_at"),
	CONSTRAINT "payhere_checkouts_kind_shape" CHECK (("payhere_checkouts"."kind" = 'fees' and "payhere_checkouts"."student_id" is not null and "payhere_checkouts"."student_id" = "payhere_checkouts"."created_by")
        or ("payhere_checkouts"."kind" = 'test' and "payhere_checkouts"."student_id" is null and "payhere_checkouts"."payment_id" is null)),
	CONSTRAINT "payhere_checkouts_paid_state" CHECK (("payhere_checkouts"."status" = 'paid') = ("payhere_checkouts"."provider_payment_id" is not null)
        and ("payhere_checkouts"."kind" = 'test' or ("payhere_checkouts"."status" = 'paid') = ("payhere_checkouts"."payment_id" is not null))
        and ("payhere_checkouts"."chargeback_at" is null or "payhere_checkouts"."status" = 'paid')
        and ("payhere_checkouts"."status_code" is null or "payhere_checkouts"."status_code" between -3 and 2)
        and (("payhere_checkouts"."status_code" is null) = ("payhere_checkouts"."notified_at" is null))),
	CONSTRAINT "payhere_checkouts_provider_payment_id" CHECK ("payhere_checkouts"."provider_payment_id" is null or char_length("payhere_checkouts"."provider_payment_id") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "payhere_checkout_lines" ADD CONSTRAINT "payhere_checkout_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payhere_checkout_lines" ADD CONSTRAINT "payhere_checkout_lines_checkout_fk" FOREIGN KEY ("tenant_id","checkout_id") REFERENCES "public"."payhere_checkouts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payhere_checkout_lines" ADD CONSTRAINT "payhere_checkout_lines_line_fk" FOREIGN KEY ("tenant_id","invoice_line_id") REFERENCES "public"."invoice_lines"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payhere_checkouts" ADD CONSTRAINT "payhere_checkouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payhere_checkouts" ADD CONSTRAINT "payhere_checkouts_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payhere_checkouts" ADD CONSTRAINT "payhere_checkouts_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payhere_checkouts" ADD CONSTRAINT "payhere_checkouts_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payhere_checkout_lines_tenant_line_idx" ON "payhere_checkout_lines" USING btree ("tenant_id","invoice_line_id");--> statement-breakpoint
CREATE INDEX "payhere_checkouts_tenant_student_created_idx" ON "payhere_checkouts" USING btree ("tenant_id","student_id","created_at");