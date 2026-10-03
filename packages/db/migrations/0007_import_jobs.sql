CREATE TYPE "public"."import_job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" "import_job_status" DEFAULT 'queued' NOT NULL,
	"created_by" uuid NOT NULL,
	"options" jsonb NOT NULL,
	"input" jsonb,
	"summary" jsonb,
	"result_rows" jsonb,
	"created" integer,
	"enrolled" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_jobs_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "import_jobs_finished_has_time" CHECK ("import_jobs"."status" NOT IN ('done', 'failed') OR "import_jobs"."finished_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."tenant_users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_jobs_tenant_created_idx" ON "import_jobs" USING btree ("tenant_id","created_at");