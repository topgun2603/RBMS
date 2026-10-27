CREATE TABLE "delivery_challans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"customer_id" uuid,
	"customer" jsonb NOT NULL,
	"seller" jsonb NOT NULL,
	"number" text NOT NULL,
	"fy" text NOT NULL,
	"seq" integer NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"reason" text NOT NULL,
	"date" date NOT NULL,
	"return_by" date,
	"place_of_supply" text NOT NULL,
	"inter_state" boolean DEFAULT false NOT NULL,
	"lines" jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"total" integer NOT NULL,
	"ship_to" text,
	"transport" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ewb_no" text,
	"ewb_date" date,
	"notes" text,
	"terms" text,
	"sale_order_id" uuid,
	"sale_order_number" text,
	"returns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"invoice_id" uuid,
	"invoice_number" text,
	"invoiced_at" timestamp with time zone,
	"location_id" uuid,
	"share_token" text,
	"sent_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_challans_share_token_uq" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "proforma_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"customer_id" uuid,
	"customer" jsonb NOT NULL,
	"seller" jsonb NOT NULL,
	"number" text NOT NULL,
	"fy" text NOT NULL,
	"seq" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"date" date NOT NULL,
	"valid_until" date,
	"place_of_supply" text NOT NULL,
	"inter_state" boolean DEFAULT false NOT NULL,
	"lines" jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"total" integer NOT NULL,
	"notes" text,
	"terms" text,
	"delivery_text" text,
	"advance_percent" integer,
	"quotation_id" uuid,
	"quotation_number" text,
	"share_token" text,
	"sent_at" timestamp with time zone,
	"invoice_id" uuid,
	"invoice_number" text,
	"converted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proforma_invoices_share_token_uq" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "sale_order_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_order_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_number" text,
	"lines" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_order_invoices_invoice_uq" UNIQUE("tenant_id","invoice_id")
);
--> statement-breakpoint
CREATE TABLE "sale_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"customer_id" uuid,
	"customer" jsonb NOT NULL,
	"seller" jsonb NOT NULL,
	"number" text NOT NULL,
	"fy" text NOT NULL,
	"seq" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"date" date NOT NULL,
	"promised_date" date,
	"customer_ref" text,
	"place_of_supply" text NOT NULL,
	"inter_state" boolean DEFAULT false NOT NULL,
	"lines" jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"total" integer NOT NULL,
	"notes" text,
	"terms" text,
	"advance_percent" integer,
	"reserve_stock" boolean DEFAULT false NOT NULL,
	"location_id" uuid,
	"quotation_id" uuid,
	"quotation_number" text,
	"share_token" text,
	"sent_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_orders_share_token_uq" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "sales_doc_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"branch_id" uuid,
	"fy" text NOT NULL,
	"prefix" text NOT NULL,
	"next_seq" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_doc_series_tenant_kind_branch_fy_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","kind","branch_id","fy")
);
--> statement-breakpoint
ALTER TABLE "customer_receipts" ADD COLUMN "against_kind" text;--> statement-breakpoint
ALTER TABLE "customer_receipts" ADD COLUMN "against_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_receipts" ADD COLUMN "against_number" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "stock_moved_by" text;--> statement-breakpoint
ALTER TABLE "sale_order_invoices" ADD CONSTRAINT "sale_order_invoices_sale_order_id_sale_orders_id_fk" FOREIGN KEY ("sale_order_id") REFERENCES "public"."sale_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_challans_tenant_branch_fy_seq_uq" ON "delivery_challans" USING btree ("tenant_id",coalesce("branch_id", '00000000-0000-0000-0000-000000000000'::uuid),"fy","seq");--> statement-breakpoint
CREATE INDEX "delivery_challans_tenant_date_idx" ON "delivery_challans" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "delivery_challans_tenant_customer_idx" ON "delivery_challans" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "delivery_challans_tenant_order_idx" ON "delivery_challans" USING btree ("tenant_id","sale_order_id");--> statement-breakpoint
CREATE INDEX "delivery_challans_tenant_invoice_idx" ON "delivery_challans" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proforma_invoices_tenant_branch_fy_seq_uq" ON "proforma_invoices" USING btree ("tenant_id",coalesce("branch_id", '00000000-0000-0000-0000-000000000000'::uuid),"fy","seq");--> statement-breakpoint
CREATE INDEX "proforma_invoices_tenant_date_idx" ON "proforma_invoices" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "proforma_invoices_tenant_customer_idx" ON "proforma_invoices" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "proforma_invoices_tenant_invoice_idx" ON "proforma_invoices" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "sale_order_invoices_tenant_order_idx" ON "sale_order_invoices" USING btree ("tenant_id","sale_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_orders_tenant_branch_fy_seq_uq" ON "sale_orders" USING btree ("tenant_id",coalesce("branch_id", '00000000-0000-0000-0000-000000000000'::uuid),"fy","seq");--> statement-breakpoint
CREATE INDEX "sale_orders_tenant_status_date_idx" ON "sale_orders" USING btree ("tenant_id","status","date");--> statement-breakpoint
CREATE INDEX "sale_orders_tenant_customer_idx" ON "sale_orders" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "customer_receipts_tenant_against_idx" ON "customer_receipts" USING btree ("tenant_id","against_id");