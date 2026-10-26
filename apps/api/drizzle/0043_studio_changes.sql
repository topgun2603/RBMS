CREATE TABLE "studio_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"request_text" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"classification" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"ops" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unsupported" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preview" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"base" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"areas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"high_risk" boolean DEFAULT false NOT NULL,
	"run_id" text,
	"credits" integer DEFAULT 0 NOT NULL,
	"error" text,
	"applied_at" timestamp with time zone,
	"applied_by" text,
	"undone_at" timestamp with time zone,
	"undone_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_feature_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"change_id" uuid,
	"trade" text DEFAULT '' NOT NULL,
	"request_text" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"missing" text NOT NULL,
	"theme" text DEFAULT 'other' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "studio_changes_tenant_created_idx" ON "studio_changes" USING btree ("tenant_id","created_at");
--> statement-breakpoint
CREATE INDEX "studio_feature_requests_theme_idx" ON "studio_feature_requests" USING btree ("theme","created_at");
--> statement-breakpoint
CREATE INDEX "studio_feature_requests_tenant_idx" ON "studio_feature_requests" USING btree ("tenant_id","created_at");
