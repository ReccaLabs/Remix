CREATE TYPE "public"."auth_ticket_kind" AS ENUM('device_limit', 'two_step', 'password');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('password_reset', 'first_password', 'unlock');--> statement-breakpoint
CREATE TABLE "auth_tickets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "auth_ticket_kind" NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" "otp_purpose",
	"code_hash" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"sends" smallint DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone,
	"stay_signed_in" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_tickets_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "auth_tickets_tenant_token_hash_key" UNIQUE("tenant_id","token_hash"),
	CONSTRAINT "auth_tickets_token_hash_length" CHECK (char_length("auth_tickets"."token_hash") BETWEEN 32 AND 128),
	CONSTRAINT "auth_tickets_code_hash_length" CHECK (char_length("auth_tickets"."code_hash") BETWEEN 32 AND 128),
	CONSTRAINT "auth_tickets_two_step_has_code" CHECK (("auth_tickets"."kind" = 'two_step') = ("auth_tickets"."code_hash" IS NOT NULL)),
	CONSTRAINT "auth_tickets_password_has_purpose" CHECK (("auth_tickets"."kind" = 'password') = ("auth_tickets"."purpose" IS NOT NULL)),
	CONSTRAINT "auth_tickets_attempts_range" CHECK ("auth_tickets"."attempts" BETWEEN 0 AND 100),
	CONSTRAINT "auth_tickets_sends_range" CHECK ("auth_tickets"."sends" BETWEEN 0 AND 100),
	CONSTRAINT "auth_tickets_expires_after_created" CHECK ("auth_tickets"."expires_at" > "auth_tickets"."created_at")
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"user_id" uuid,
	"purpose" "otp_purpose" NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_challenges_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "otp_challenges_phone_lk_mobile" CHECK ("otp_challenges"."phone" ~ '^[+]947[0-9]{8}$'),
	CONSTRAINT "otp_challenges_code_hash_length" CHECK (char_length("otp_challenges"."code_hash") BETWEEN 32 AND 128),
	CONSTRAINT "otp_challenges_attempts_range" CHECK ("otp_challenges"."attempts" BETWEEN 0 AND 100),
	CONSTRAINT "otp_challenges_expires_after_created" CHECK ("otp_challenges"."expires_at" > "otp_challenges"."created_at")
);
--> statement-breakpoint
CREATE TABLE "staff_invites" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"phone" text,
	"email" text,
	"role" "staff_role" NOT NULL,
	"class_scope" uuid[],
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_invites_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "staff_invites_tenant_token_hash_key" UNIQUE("tenant_id","token_hash"),
	CONSTRAINT "staff_invites_token_hash_length" CHECK (char_length("staff_invites"."token_hash") BETWEEN 32 AND 128),
	CONSTRAINT "staff_invites_display_name_length" CHECK (char_length("staff_invites"."display_name") BETWEEN 1 AND 120),
	CONSTRAINT "staff_invites_phone_e164" CHECK ("staff_invites"."phone" ~ '^[+][1-9][0-9]{7,14}$'),
	CONSTRAINT "staff_invites_has_contact" CHECK ("staff_invites"."phone" IS NOT NULL OR "staff_invites"."email" IS NOT NULL),
	CONSTRAINT "staff_invites_expires_after_created" CHECK ("staff_invites"."expires_at" > "staff_invites"."created_at"),
	CONSTRAINT "staff_invites_accepted_has_user" CHECK ("staff_invites"."accepted_at" IS NULL OR "staff_invites"."accepted_user_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "trust_token_hash" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "trusted_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_users" ADD COLUMN "failed_login_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_users" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_users" ADD COLUMN "last_sign_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_tickets" ADD CONSTRAINT "auth_tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tickets" ADD CONSTRAINT "auth_tickets_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_invited_by_fk" FOREIGN KEY ("tenant_id","invited_by") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_accepted_user_fk" FOREIGN KEY ("tenant_id","accepted_user_id") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "otp_challenges_open_idx" ON "otp_challenges" USING btree ("tenant_id","phone","purpose") WHERE "otp_challenges"."consumed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "staff_invites_pending_idx" ON "staff_invites" USING btree ("tenant_id","expires_at") WHERE "staff_invites"."accepted_at" IS NULL AND "staff_invites"."revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_trust_token_hash_key" UNIQUE("tenant_id","trust_token_hash");--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_trust_token_hash_length" CHECK (char_length("devices"."trust_token_hash") BETWEEN 32 AND 128);--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_trust_pair" CHECK (("devices"."trust_token_hash" IS NULL) = ("devices"."trusted_until" IS NULL));--> statement-breakpoint
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_failed_login_count_range" CHECK ("tenant_users"."failed_login_count" BETWEEN 0 AND 1000);