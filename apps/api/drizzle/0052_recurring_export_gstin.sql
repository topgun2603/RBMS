CREATE TABLE "gstin_lookup_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"gstin" text NOT NULL,
	"user_id" uuid,
	"ok" boolean DEFAULT true NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gstin_lookups" (
	"gstin" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"found" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"details" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"lines" jsonb NOT NULL,
	"place_of_supply" text,
	"notes" text,
	"due_days" integer,
	"frequency" text NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"day_of_month" integer,
	"weekday" integer,
	"start_date" date NOT NULL,
	"end_date" date,
	"max_count" integer,
	"count" integer DEFAULT 0 NOT NULL,
	"next_run_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"issue_mode" text DEFAULT 'draft' NOT NULL,
	"price_mode" text DEFAULT 'fixed' NOT NULL,
	"send_channel" text DEFAULT 'none' NOT NULL,
	"send_locale" text,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"run_date" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invoice_id" uuid,
	"invoice_number" text,
	"total" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"sent_log_id" text,
	"trigger" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_runs_profile_date_uq" UNIQUE("profile_id","run_date")
);
--> statement-breakpoint
ALTER TABLE "billing_customers" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "foreign_amount" integer;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "exchange_rate" double precision;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "forex_diff" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "supply_type" text DEFAULT 'domestic' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "exchange_rate" double precision;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "foreign" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "export_details" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "recurring_run_id" uuid;--> statement-breakpoint
ALTER TABLE "recurring_runs" ADD CONSTRAINT "recurring_runs_profile_id_recurring_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."recurring_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gstin_lookup_log_tenant_at_idx" ON "gstin_lookup_log" USING btree ("tenant_id","at");--> statement-breakpoint
CREATE INDEX "gstin_lookups_fetched_idx" ON "gstin_lookups" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "recurring_profiles_tenant_status_idx" ON "recurring_profiles" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "recurring_profiles_tenant_customer_idx" ON "recurring_profiles" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "recurring_profiles_due_idx" ON "recurring_profiles" USING btree ("status","next_run_date");--> statement-breakpoint
CREATE INDEX "recurring_runs_tenant_profile_idx" ON "recurring_runs" USING btree ("tenant_id","profile_id","run_date");