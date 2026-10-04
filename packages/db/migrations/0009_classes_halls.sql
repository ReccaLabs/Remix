CREATE TABLE "halls" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "halls_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "halls_name_length" CHECK (char_length("halls"."name") BETWEEN 1 AND 60),
	CONSTRAINT "halls_capacity_range" CHECK ("halls"."capacity" BETWEEN 1 AND 5000)
);
--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "hall_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "favicon_url" text;--> statement-breakpoint
ALTER TABLE "halls" ADD CONSTRAINT "halls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "halls_tenant_name_key" ON "halls" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_hall_fk" FOREIGN KEY ("tenant_id","hall_id") REFERENCES "public"."halls"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_favicon_url_https" CHECK ("tenants"."favicon_url" ~ '^https://');