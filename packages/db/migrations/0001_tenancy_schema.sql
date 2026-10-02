CREATE TYPE "public"."actor_kind" AS ENUM('student', 'staff', 'platform', 'system');--> statement-breakpoint
CREATE TYPE "public"."app_locale" AS ENUM('en', 'si', 'ta');--> statement-breakpoint
CREATE TYPE "public"."class_place" AS ENUM('hall', 'online', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."medium" AS ENUM('sinhala', 'tamil', 'english');--> statement-breakpoint
CREATE TYPE "public"."plan_id" AS ENUM('lite', 'tutor', 'institute', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('owner', 'admin', 'teacher', 'cashier', 'gatekeeper');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('trial', 'active', 'past_due', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_kind" AS ENUM('student', 'staff');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled', 'invited');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_id" uuid,
	"actor_kind" "actor_kind" NOT NULL,
	"impersonated_by" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" "inet",
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "audit_logs_action_format" CHECK ("audit_logs"."action" ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'),
	CONSTRAINT "audit_logs_entity_length" CHECK (char_length("audit_logs"."entity") BETWEEN 1 AND 64),
	CONSTRAINT "audit_logs_request_id_length" CHECK (char_length("audit_logs"."request_id") <= 128)
);
--> statement-breakpoint
CREATE TABLE "class_schedules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_schedules_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "class_schedules_weekday_iso" CHECK ("class_schedules"."weekday" BETWEEN 1 AND 7),
	CONSTRAINT "class_schedules_duration_range" CHECK ("class_schedules"."duration_minutes" BETWEEN 15 AND 600)
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"grade" text NOT NULL,
	"medium" "medium" NOT NULL,
	"teacher_id" uuid,
	"fee_cents" bigint NOT NULL,
	"place" "class_place" NOT NULL,
	"starts_on" date,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classes_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "classes_name_length" CHECK (char_length("classes"."name") BETWEEN 1 AND 120),
	CONSTRAINT "classes_grade_length" CHECK (char_length("classes"."grade") BETWEEN 1 AND 40),
	CONSTRAINT "classes_fee_non_negative" CHECK ("classes"."fee_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"user_agent" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signed_out_at" timestamp with time zone,
	"signed_out_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "devices_tenant_token_hash_key" UNIQUE("tenant_id","token_hash"),
	CONSTRAINT "devices_token_hash_length" CHECK (char_length("devices"."token_hash") BETWEEN 32 AND 128),
	CONSTRAINT "devices_label_length" CHECK (char_length("devices"."label") BETWEEN 1 AND 120),
	CONSTRAINT "devices_user_agent_length" CHECK (char_length("devices"."user_agent") <= 512)
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"from_month" date NOT NULL,
	"to_month" date,
	"fee_override_cents" bigint,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollments_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "enrollments_from_month_first_day" CHECK (extract(day from "enrollments"."from_month") = 1),
	CONSTRAINT "enrollments_to_month_first_day" CHECK (extract(day from "enrollments"."to_month") = 1),
	CONSTRAINT "enrollments_month_order" CHECK ("enrollments"."to_month" >= "enrollments"."from_month"),
	CONSTRAINT "enrollments_fee_override_non_negative" CHECK ("enrollments"."fee_override_cents" >= 0),
	CONSTRAINT "enrollments_fee_override_has_reason" CHECK ("enrollments"."fee_override_cents" IS NULL OR "enrollments"."reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"prev_token_hash" text,
	"family_id" uuid NOT NULL,
	"device_id" uuid,
	"stay_signed_in" boolean DEFAULT false NOT NULL,
	"rotated_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"impersonated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "sessions_tenant_token_hash_key" UNIQUE("tenant_id","token_hash"),
	CONSTRAINT "sessions_token_hash_length" CHECK (char_length("sessions"."token_hash") BETWEEN 32 AND 128),
	CONSTRAINT "sessions_prev_token_hash_length" CHECK (char_length("sessions"."prev_token_hash") BETWEEN 32 AND 128),
	CONSTRAINT "sessions_revoked_reason_needs_revoked_at" CHECK ("sessions"."revoked_reason" IS NULL OR "sessions"."revoked_at" IS NOT NULL),
	CONSTRAINT "sessions_expires_after_created" CHECK ("sessions"."expires_at" > "sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "staff_roles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "staff_role" NOT NULL,
	"class_scope" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_roles_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "staff_roles_tenant_user_role_key" UNIQUE("tenant_id","user_id","role")
);
--> statement-breakpoint
CREATE TABLE "students" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_no" text NOT NULL,
	"school" text,
	"al_year" smallint,
	"medium" "medium",
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_tenant_id_user_id_key" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "students_tenant_student_no_key" UNIQUE("tenant_id","student_no"),
	CONSTRAINT "students_student_no_length" CHECK (char_length("students"."student_no") BETWEEN 1 AND 32),
	CONSTRAINT "students_al_year_range" CHECK ("students"."al_year" BETWEEN 2000 AND 2100)
);
--> statement-breakpoint
CREATE TABLE "tenant_counters" (
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period" text DEFAULT '' NOT NULL,
	"value" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_counters_pkey" PRIMARY KEY("tenant_id","kind","period"),
	CONSTRAINT "tenant_counters_kind_format" CHECK ("tenant_counters"."kind" ~ '^[a-z][a-z_]{0,31}$'),
	CONSTRAINT "tenant_counters_period_length" CHECK (char_length("tenant_counters"."period") <= 16),
	CONSTRAINT "tenant_counters_value_non_negative" CHECK ("tenant_counters"."value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tenant_domains" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"host" text NOT NULL,
	"verified_at" timestamp with time zone,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_domains_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "tenant_domains_host_format" CHECK ("tenant_domains"."host" ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' AND char_length("tenant_domains"."host") <= 253)
);
--> statement-breakpoint
CREATE TABLE "tenant_users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "user_kind" NOT NULL,
	"phone" text,
	"email" text,
	"password_hash" text,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"display_name" text NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"locale" "app_locale" DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_users_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "tenant_users_phone_e164" CHECK ("tenant_users"."phone" ~ '^[+][1-9][0-9]{7,14}$'),
	CONSTRAINT "tenant_users_email_format" CHECK (char_length("tenant_users"."email") <= 254 AND "tenant_users"."email" ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
	CONSTRAINT "tenant_users_has_identifier" CHECK ("tenant_users"."phone" IS NOT NULL OR "tenant_users"."email" IS NOT NULL),
	CONSTRAINT "tenant_users_student_has_phone" CHECK ("tenant_users"."kind" <> 'student' OR "tenant_users"."phone" IS NOT NULL),
	CONSTRAINT "tenant_users_active_has_password" CHECK ("tenant_users"."status" <> 'active' OR "tenant_users"."password_hash" IS NOT NULL),
	CONSTRAINT "tenant_users_display_name_length" CHECK (char_length("tenant_users"."display_name") BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" "tenant_status" DEFAULT 'trial' NOT NULL,
	"plan" "plan_id" NOT NULL,
	"default_locale" "app_locale" DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'Asia/Colombo' NOT NULL,
	"student_no_prefix" text NOT NULL,
	"brand_color" text,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_format" CHECK ("tenants"."slug" ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' AND position('--' in "tenants"."slug") = 0),
	CONSTRAINT "tenants_name_length" CHECK (char_length("tenants"."name") BETWEEN 2 AND 120),
	CONSTRAINT "tenants_timezone_supported" CHECK ("tenants"."timezone" = 'Asia/Colombo'),
	CONSTRAINT "tenants_student_no_prefix_format" CHECK ("tenants"."student_no_prefix" ~ '^[A-Z]{1,6}$'),
	CONSTRAINT "tenants_brand_color_format" CHECK ("tenants"."brand_color" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "tenants_logo_url_https" CHECK ("tenants"."logo_url" ~ '^https://')
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_class_fk" FOREIGN KEY ("tenant_id","class_id") REFERENCES "public"."classes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_teacher_fk" FOREIGN KEY ("tenant_id","teacher_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_signed_out_by_fk" FOREIGN KEY ("tenant_id","signed_out_by") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_class_fk" FOREIGN KEY ("tenant_id","class_id") REFERENCES "public"."classes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_counters" ADD CONSTRAINT "tenant_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_created_idx" ON "audit_logs" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_entity_idx" ON "audit_logs" USING btree ("tenant_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX "class_schedules_tenant_class_idx" ON "class_schedules" USING btree ("tenant_id","class_id");--> statement-breakpoint
CREATE INDEX "classes_tenant_teacher_idx" ON "classes" USING btree ("tenant_id","teacher_id");--> statement-breakpoint
CREATE INDEX "devices_active_by_user_idx" ON "devices" USING btree ("tenant_id","user_id") WHERE "devices"."signed_out_at" IS NULL;--> statement-breakpoint
CREATE INDEX "enrollments_tenant_class_idx" ON "enrollments" USING btree ("tenant_id","class_id");--> statement-breakpoint
CREATE INDEX "enrollments_tenant_student_idx" ON "enrollments" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE INDEX "sessions_tenant_prev_token_hash_idx" ON "sessions" USING btree ("tenant_id","prev_token_hash");--> statement-breakpoint
CREATE INDEX "sessions_tenant_family_idx" ON "sessions" USING btree ("tenant_id","family_id");--> statement-breakpoint
CREATE INDEX "sessions_active_by_user_idx" ON "sessions" USING btree ("tenant_id","user_id") WHERE "sessions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "students_tenant_active_idx" ON "students" USING btree ("tenant_id") WHERE "students"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_domains_host_key" ON "tenant_domains" USING btree ("host");--> statement-breakpoint
CREATE INDEX "tenant_domains_tenant_idx" ON "tenant_domains" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_domains_one_primary" ON "tenant_domains" USING btree ("tenant_id") WHERE "tenant_domains"."is_primary";--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_users_tenant_phone_key" ON "tenant_users" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_users_tenant_email_key" ON "tenant_users" USING btree ("tenant_id",lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants" USING btree ("slug");