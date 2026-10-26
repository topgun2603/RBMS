CREATE TABLE "ai_activity_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"alert_key" text NOT NULL,
	"reviewed_by" text,
	"reviewed_by_name" text,
	"note" text,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_counter_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"user_id" text,
	"user_name" text,
	"till_session_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_staff_coaching" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"staff_key" text NOT NULL,
	"staff_name" text NOT NULL,
	"lang" text NOT NULL,
	"notes" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"source" text NOT NULL,
	"fallback_reason" text,
	"run_id" text,
	"credits" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_activity_reviews_uq" ON "ai_activity_reviews" USING btree ("tenant_id","alert_key");--> statement-breakpoint
CREATE INDEX "ai_counter_events_tenant_at_idx" ON "ai_counter_events" USING btree ("tenant_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_staff_coaching_uq" ON "ai_staff_coaching" USING btree ("tenant_id","week_start","staff_key","lang");