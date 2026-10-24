CREATE TABLE "ai_daily_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"trigger" text DEFAULT 'schedule' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"source" text,
	"fallback_reason" text,
	"facts" jsonb,
	"narrative" text,
	"actions" jsonb,
	"run_id" uuid,
	"credits" integer DEFAULT 0 NOT NULL,
	"delivery" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_daily_summaries_tenant_date_uq" ON "ai_daily_summaries" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "ai_daily_summaries_tenant_idx" ON "ai_daily_summaries" USING btree ("tenant_id","created_at");