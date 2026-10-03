CREATE TYPE "public"."consent_method" AS ENUM('paper_form', 'verbal', 'online');--> statement-breakpoint
CREATE TYPE "public"."guardian_relation" AS ENUM('mother', 'father', 'guardian', 'other');--> statement-breakpoint
CREATE TABLE "guardians" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relation" "guardian_relation" NOT NULL,
	"phone" text NOT NULL,
	"sms_opt_in" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guardians_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "guardians_tenant_student_phone_key" UNIQUE("tenant_id","student_id","phone"),
	CONSTRAINT "guardians_phone_e164" CHECK ("guardians"."phone" ~ '^[+][1-9][0-9]{7,14}$'),
	CONSTRAINT "guardians_name_length" CHECK (char_length("guardians"."name") BETWEEN 1 AND 120)
);
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "under18" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "consent_given_by" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "consent_method" "consent_method";--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "consent_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "consent_recorded_by" uuid;--> statement-breakpoint
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guardians_tenant_student_idx" ON "guardians" USING btree ("tenant_id","student_id");--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_consent_recorded_by_fk" FOREIGN KEY ("tenant_id","consent_recorded_by") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_under18_has_consent" CHECK (NOT "students"."under18" OR ("students"."consent_given_by" IS NOT NULL AND "students"."consent_method" IS NOT NULL AND "students"."consent_recorded_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_consent_given_by_length" CHECK (char_length("students"."consent_given_by") BETWEEN 1 AND 120);