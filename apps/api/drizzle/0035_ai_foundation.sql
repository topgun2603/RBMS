CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text,
	"feature" text NOT NULL,
	"tier" text NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" integer DEFAULT 0 NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"steps" integer DEFAULT 1 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"period" text NOT NULL,
	"feedback" text,
	"feedback_note" text,
	"feedback_at" timestamp with time zone,
	"debug" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_runs_tenant_created_idx" ON "ai_runs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_tenant_period_idx" ON "ai_runs" USING btree ("tenant_id","period","feature");