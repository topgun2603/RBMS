CREATE TABLE "billing_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"gstin" text,
	"address" text,
	"state_code" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hsn" text,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"rate" integer NOT NULL,
	"gst_rate" real NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"method" text NOT NULL,
	"date" date NOT NULL,
	"reference" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_series" (
	"tenant_id" uuid NOT NULL,
	"fy" text NOT NULL,
	"prefix" text NOT NULL,
	"next_seq" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_series_pk" PRIMARY KEY("tenant_id","fy")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid,
	"customer" jsonb NOT NULL,
	"seller" jsonb,
	"number" text,
	"fy" text,
	"seq" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"date" date NOT NULL,
	"due_date" date,
	"place_of_supply" text NOT NULL,
	"inter_state" boolean DEFAULT false NOT NULL,
	"lines" jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"total" integer NOT NULL,
	"paid" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"share_token" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_share_token_uq" UNIQUE("share_token"),
	CONSTRAINT "invoices_tenant_fy_seq_uq" UNIQUE("tenant_id","fy","seq")
);
--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_customers_tenant_name_idx" ON "billing_customers" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "billing_items_tenant_name_idx" ON "billing_items" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "invoice_payments_tenant_invoice_idx" ON "invoice_payments" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_payments_tenant_date_idx" ON "invoice_payments" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "invoices_tenant_status_date_idx" ON "invoices" USING btree ("tenant_id","status","date");--> statement-breakpoint
CREATE INDEX "invoices_tenant_customer_idx" ON "invoices" USING btree ("tenant_id","customer_id");