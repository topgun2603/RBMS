CREATE TABLE "booking_appointment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"service_id" uuid,
	"item_id" uuid,
	"name" text NOT NULL,
	"duration_min" integer NOT NULL,
	"rate" integer NOT NULL,
	"gst_rate" real DEFAULT 18 NOT NULL,
	"hsn" text,
	"unit" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"business_date" date NOT NULL,
	"staff_id" uuid,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	"buffer_min" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"source" text DEFAULT 'staff' NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text,
	"customer_id" uuid,
	"notes" text,
	"invoice_id" uuid,
	"cancel_reason" text,
	"manage_token" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_appointments_tenant_date_number_uq" UNIQUE("tenant_id","business_date","number"),
	CONSTRAINT "booking_appointments_manage_token_uq" UNIQUE("manage_token")
);
--> statement-breakpoint
CREATE TABLE "booking_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid,
	"weekday" integer NOT NULL,
	"opens" text NOT NULL,
	"closes" text NOT NULL,
	"breaks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_hours_tenant_staff_day_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","staff_id","weekday")
);
--> statement-breakpoint
CREATE TABLE "booking_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"duration_min" integer NOT NULL,
	"buffer_min" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"online_bookable" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_services_tenant_item_uq" UNIQUE("tenant_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "booking_staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"user_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"color" text DEFAULT '#6366f1' NOT NULL,
	"service_item_ids" uuid[] DEFAULT '{}' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_timeoff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid,
	"from" timestamp with time zone NOT NULL,
	"to" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobcard_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"jobcard_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"note" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobcard_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"jobcard_id" uuid NOT NULL,
	"kind" text DEFAULT 'part' NOT NULL,
	"item_id" uuid,
	"description" text NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"rate" integer NOT NULL,
	"gst_rate" real DEFAULT 18 NOT NULL,
	"hsn" text,
	"unit" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobcards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"template" text DEFAULT 'general' NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text,
	"customer_id" uuid,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"due_date" date,
	"assignee_name" text,
	"assignee_user_id" uuid,
	"priority" text DEFAULT 'normal' NOT NULL,
	"advance" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"invoice_id" uuid,
	"invoice_number" text,
	"track_token" text NOT NULL,
	"created_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobcards_tenant_number_uq" UNIQUE("tenant_id","number"),
	CONSTRAINT "jobcards_track_token_uq" UNIQUE("track_token")
);
--> statement-breakpoint
CREATE TABLE "membership_checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_no" integer NOT NULL,
	"member_code" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"customer_id" uuid,
	"notes" text,
	"photo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_members_tenant_no_uq" UNIQUE("tenant_id","member_no"),
	CONSTRAINT "membership_members_tenant_code_uq" UNIQUE("tenant_id","member_code"),
	CONSTRAINT "membership_members_tenant_phone_uq" UNIQUE("tenant_id","phone")
);
--> statement-breakpoint
CREATE TABLE "membership_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"duration_days" integer NOT NULL,
	"sessions" integer,
	"price" integer DEFAULT 0 NOT NULL,
	"gst_rate" real DEFAULT 18 NOT NULL,
	"item_id" uuid,
	"freeze_days_allowed" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_plans_tenant_name_uq" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "membership_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"sessions_total" integer,
	"sessions_used" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"frozen_from" date,
	"freeze_days_allowed" integer DEFAULT 0 NOT NULL,
	"freeze_days_used" integer DEFAULT 0 NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	"invoice_id" uuid,
	"renewed_from_id" uuid,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"sold_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "booking_appointment_items_tenant_appt_idx" ON "booking_appointment_items" USING btree ("tenant_id","appointment_id");--> statement-breakpoint
CREATE INDEX "booking_appointments_tenant_start_idx" ON "booking_appointments" USING btree ("tenant_id","start");--> statement-breakpoint
CREATE INDEX "booking_appointments_tenant_staff_idx" ON "booking_appointments" USING btree ("tenant_id","staff_id","start");--> statement-breakpoint
CREATE INDEX "booking_appointments_tenant_status_idx" ON "booking_appointments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "booking_staff_tenant_idx" ON "booking_staff" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE INDEX "booking_timeoff_tenant_range_idx" ON "booking_timeoff" USING btree ("tenant_id","from","to");--> statement-breakpoint
CREATE INDEX "jobcard_events_tenant_job_idx" ON "jobcard_events" USING btree ("tenant_id","jobcard_id","created_at");--> statement-breakpoint
CREATE INDEX "jobcard_lines_tenant_job_idx" ON "jobcard_lines" USING btree ("tenant_id","jobcard_id");--> statement-breakpoint
CREATE INDEX "jobcards_tenant_status_idx" ON "jobcards" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "jobcards_tenant_due_idx" ON "jobcards" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE INDEX "jobcards_tenant_updated_idx" ON "jobcards" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "membership_checkins_tenant_member_at_idx" ON "membership_checkins" USING btree ("tenant_id","member_id","at");--> statement-breakpoint
CREATE INDEX "membership_checkins_tenant_at_idx" ON "membership_checkins" USING btree ("tenant_id","at");--> statement-breakpoint
CREATE INDEX "membership_members_tenant_name_idx" ON "membership_members" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "membership_plans_tenant_sort_idx" ON "membership_plans" USING btree ("tenant_id","sort");--> statement-breakpoint
CREATE INDEX "membership_subscriptions_tenant_member_idx" ON "membership_subscriptions" USING btree ("tenant_id","member_id","end_date");--> statement-breakpoint
CREATE INDEX "membership_subscriptions_tenant_end_idx" ON "membership_subscriptions" USING btree ("tenant_id","end_date");--> statement-breakpoint
CREATE INDEX "membership_subscriptions_tenant_plan_idx" ON "membership_subscriptions" USING btree ("tenant_id","plan_id");