CREATE TABLE "breach_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"occurred_at" timestamp with time zone,
	"discovered_at" timestamp with time zone NOT NULL,
	"board_deadline_at" timestamp with time zone NOT NULL,
	"data_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"people_affected" integer,
	"containment" text DEFAULT '' NOT NULL,
	"cause" text DEFAULT '' NOT NULL,
	"board_intimated_at" timestamp with time zone,
	"board_reported_at" timestamp with time zone,
	"board_reference" text,
	"people_notified_at" timestamp with time zone,
	"people_notified_note" text,
	"checklist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"version" integer NOT NULL,
	"content_hash" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"note" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"source" text NOT NULL,
	"subject_user_id" uuid,
	"subject_name" text,
	"subject_phone" text,
	"subject_email" text,
	"details" text,
	"nominee" jsonb,
	"purposes" text[],
	"due_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"handled_by" uuid,
	"resolution" text,
	"result" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_retention_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"category" text NOT NULL,
	"dry_run" boolean NOT NULL,
	"cutoff" timestamp with time zone NOT NULL,
	"days" integer NOT NULL,
	"affected" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"error" text,
	"trigger" text DEFAULT 'job' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "privacy_request_events" ADD CONSTRAINT "privacy_request_events_request_id_privacy_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."privacy_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "breach_incidents_ref_uq" ON "breach_incidents" USING btree (coalesce("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid),"reference");--> statement-breakpoint
CREATE INDEX "breach_incidents_tenant_idx" ON "breach_incidents" USING btree ("tenant_id","status","board_deadline_at");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_notices_version_uq" ON "privacy_notices" USING btree (coalesce("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid),"version");--> statement-breakpoint
CREATE INDEX "privacy_notices_tenant_idx" ON "privacy_notices" USING btree ("tenant_id","version");--> statement-breakpoint
CREATE INDEX "privacy_request_events_request_idx" ON "privacy_request_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "privacy_requests_tenant_status_idx" ON "privacy_requests" USING btree ("tenant_id","status","due_at");--> statement-breakpoint
CREATE INDEX "privacy_requests_subject_idx" ON "privacy_requests" USING btree ("tenant_id","subject_user_id");--> statement-breakpoint
CREATE INDEX "privacy_retention_runs_tenant_idx" ON "privacy_retention_runs" USING btree ("tenant_id","created_at");