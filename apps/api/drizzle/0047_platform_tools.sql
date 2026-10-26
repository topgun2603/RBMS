CREATE TABLE "platform_release_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title_en" text DEFAULT '' NOT NULL,
	"title_ta" text DEFAULT '' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'paste' NOT NULL,
	"since_ref" text,
	"removed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"run_id" text,
	"created_by" uuid,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_release_seen" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_shop_followups" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"contacted_at" timestamp with time zone,
	"contacted_by" uuid,
	"snoozed_until" timestamp with time zone,
	"ignored" boolean DEFAULT false NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_kind" text NOT NULL,
	"author_id" uuid,
	"author_name" text,
	"kind" text DEFAULT 'reply' NOT NULL,
	"body" text NOT NULL,
	"from_draft" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"seq" integer NOT NULL,
	"requester_user_id" uuid,
	"requester_name" text,
	"requester_role" text,
	"subject" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"source" text DEFAULT 'menu' NOT NULL,
	"screen" text,
	"question" text,
	"app_id" text,
	"category" text,
	"urgency" text,
	"language" text,
	"triage" jsonb,
	"triage_status" text DEFAULT 'queued' NOT NULL,
	"triage_run_id" text,
	"triaged_at" timestamp with time zone,
	"shop_unread" boolean DEFAULT false NOT NULL,
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_ticket_messages" ADD CONSTRAINT "platform_ticket_messages_ticket_id_platform_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."platform_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_release_notes_status_idx" ON "platform_release_notes" USING btree ("status","published_at");--> statement-breakpoint
CREATE INDEX "platform_ticket_messages_ticket_idx" ON "platform_ticket_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_tickets_seq_uq" ON "platform_tickets" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "platform_tickets_tenant_idx" ON "platform_tickets" USING btree ("tenant_id","last_message_at");--> statement-breakpoint
CREATE INDEX "platform_tickets_status_idx" ON "platform_tickets" USING btree ("status","last_message_at");--> statement-breakpoint
CREATE INDEX "platform_tickets_created_idx" ON "platform_tickets" USING btree ("created_at");