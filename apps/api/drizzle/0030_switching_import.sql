CREATE TABLE "export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_by" uuid,
	"file_key" text,
	"file_name" text,
	"file_size" integer,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"expires_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"external_key" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text DEFAULT 'created' NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "options" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "ignored_rows" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "rollback" jsonb;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "rolled_back_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "rolled_back_by" uuid;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "imported" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "imported" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
CREATE INDEX "export_jobs_tenant_created_idx" ON "export_jobs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_records_tenant_entity_key_uq" ON "import_records" USING btree ("tenant_id","entity","external_key");--> statement-breakpoint
CREATE INDEX "import_records_tenant_batch_idx" ON "import_records" USING btree ("tenant_id","batch_id");