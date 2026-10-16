CREATE TABLE "credit_note_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"fy" text NOT NULL,
	"prefix" text NOT NULL,
	"next_seq" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_note_series_tenant_branch_fy_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","branch_id","fy")
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"branch_id" uuid,
	"customer_id" uuid,
	"customer" jsonb NOT NULL,
	"seller" jsonb NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_date" date NOT NULL,
	"number" text NOT NULL,
	"fy" text NOT NULL,
	"seq" integer NOT NULL,
	"date" date NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"refund_mode" text NOT NULL,
	"refund_amount" integer DEFAULT 0 NOT NULL,
	"refund_payment_id" uuid,
	"place_of_supply" text NOT NULL,
	"inter_state" boolean NOT NULL,
	"lines" jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"total" integer NOT NULL,
	"till_session_id" uuid,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "till_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"register" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"date" date NOT NULL,
	"opening_cash" integer NOT NULL,
	"opening_count" jsonb,
	"opened_by" uuid,
	"opened_by_name" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cash_entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"closing_count" jsonb,
	"expected_cash" integer,
	"counted_cash" integer,
	"difference" integer,
	"summary" jsonb,
	"note" text,
	"closed_by" uuid,
	"closed_by_name" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_product_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"product_name" text NOT NULL,
	"product_image" text,
	"reason" text,
	"changed_after_approval" boolean DEFAULT false NOT NULL,
	"changed_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_product_reviews_product_uq" UNIQUE("tenant_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "credit_note_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "till_session_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "credited" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "till_session_id" uuid;--> statement-breakpoint
ALTER TABLE "vendor_orders" ADD COLUMN "packed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vendor_orders" ADD COLUMN "shipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vendor_orders" ADD COLUMN "carrier" text;--> statement-breakpoint
ALTER TABLE "vendor_orders" ADD COLUMN "tracking_number" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "stock_location_id" uuid;--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD COLUMN "credit_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD COLUMN "credit_label" text;--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD COLUMN "refund_due_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_reason" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_provider_subscription_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_provider_plan_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_auth_url" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_credit_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_carryover_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_credit_label" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_charge_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "credit_balance_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_product_reviews" ADD CONSTRAINT "vendor_product_reviews_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_tenant_branch_fy_seq_uq" ON "credit_notes" USING btree ("tenant_id",coalesce("branch_id", '00000000-0000-0000-0000-000000000000'::uuid),"fy","seq");--> statement-breakpoint
CREATE INDEX "credit_notes_tenant_invoice_idx" ON "credit_notes" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "credit_notes_tenant_date_idx" ON "credit_notes" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "credit_notes_tenant_customer_idx" ON "credit_notes" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "credit_notes_tenant_till_idx" ON "credit_notes" USING btree ("tenant_id","till_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "till_sessions_open_register_uq" ON "till_sessions" USING btree ("tenant_id",coalesce("branch_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("register")) WHERE "till_sessions"."status" = 'open';--> statement-breakpoint
CREATE INDEX "till_sessions_tenant_date_idx" ON "till_sessions" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "vendor_product_reviews_status_idx" ON "vendor_product_reviews" USING btree ("tenant_id","status","submitted_at");--> statement-breakpoint
CREATE INDEX "vendor_product_reviews_vendor_idx" ON "vendor_product_reviews" USING btree ("tenant_id","vendor_id");--> statement-breakpoint
CREATE INDEX "invoice_payments_tenant_till_idx" ON "invoice_payments" USING btree ("tenant_id","till_session_id");--> statement-breakpoint
CREATE INDEX "subscriptions_pending_provider_sub_idx" ON "subscriptions" USING btree ("pending_provider_subscription_id");