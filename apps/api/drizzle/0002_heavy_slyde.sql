CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid,
	"supplier" jsonb NOT NULL,
	"bill_number" text NOT NULL,
	"date" date NOT NULL,
	"place_of_supply" text NOT NULL,
	"inter_state" boolean DEFAULT false NOT NULL,
	"lines" jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"total" integer NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'recorded' NOT NULL,
	"notes" text,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"track" boolean DEFAULT true NOT NULL,
	"qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"reorder_level" numeric(14, 3) DEFAULT '0' NOT NULL,
	"avg_cost" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_items_tenant_item_uq" UNIQUE("tenant_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"delta" numeric(14, 3) NOT NULL,
	"qty_after" numeric(14, 3) NOT NULL,
	"reason" text NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"ref_number" text,
	"unit_cost" integer,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
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
CREATE TABLE "customer_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"method" text NOT NULL,
	"date" date NOT NULL,
	"reference" text,
	"note" text,
	"advance" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid,
	"customer_id" uuid,
	"template" text NOT NULL,
	"channel" text NOT NULL,
	"to_masked" text NOT NULL,
	"log_id" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"day" integer NOT NULL,
	"channel" text NOT NULL,
	"log_id" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_reminders_invoice_day_uq" UNIQUE("invoice_id","day")
);
--> statement-breakpoint
CREATE TABLE "payment_accounts" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'razorpay' NOT NULL,
	"key_id" text NOT NULL,
	"key_secret_enc" text NOT NULL,
	"webhook_secret_enc" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_event_id" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_events_provider_event_uq" UNIQUE("provider_event_id")
);
--> statement-breakpoint
CREATE TABLE "payment_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purpose_kind" text NOT NULL,
	"purpose_id" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"provider_payment_id" text,
	"method" text,
	"paid_at" timestamp with time zone,
	"notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_orders_provider_order_uq" UNIQUE("provider_order_id"),
	CONSTRAINT "payment_orders_provider_payment_uq" UNIQUE("provider_payment_id")
);
--> statement-breakpoint
ALTER TABLE "billing_customers" ADD COLUMN "opening_balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_customers" ADD COLUMN "credit_limit" integer;--> statement-breakpoint
ALTER TABLE "billing_customers" ADD COLUMN "statement_token" text;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "receipt_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_customer_id_billing_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."billing_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_messages" ADD CONSTRAINT "invoice_messages_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_reminders" ADD CONSTRAINT "invoice_reminders_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchases_tenant_date_idx" ON "purchases" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "purchases_tenant_supplier_idx" ON "purchases" USING btree ("tenant_id","supplier_id");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_item_created_idx" ON "stock_movements" USING btree ("tenant_id","item_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_ref_idx" ON "stock_movements" USING btree ("tenant_id","ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "suppliers_tenant_name_idx" ON "suppliers" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "customer_receipts_tenant_customer_date_idx" ON "customer_receipts" USING btree ("tenant_id","customer_id","date");--> statement-breakpoint
CREATE INDEX "customer_receipts_tenant_date_idx" ON "customer_receipts" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "invoice_messages_tenant_invoice_idx" ON "invoice_messages" USING btree ("tenant_id","invoice_id","sent_at");--> statement-breakpoint
CREATE INDEX "invoice_messages_tenant_customer_idx" ON "invoice_messages" USING btree ("tenant_id","customer_id","sent_at");--> statement-breakpoint
CREATE INDEX "payment_orders_tenant_purpose_idx" ON "payment_orders" USING btree ("tenant_id","purpose_kind","purpose_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_orders_tenant_created_idx" ON "payment_orders" USING btree ("tenant_id","created_at");--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_receipt_id_customer_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."customer_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_payments_receipt_idx" ON "invoice_payments" USING btree ("receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_payments_online_ref_uq" ON "invoice_payments" USING btree ("invoice_id","reference") WHERE "invoice_payments"."source" = 'online';--> statement-breakpoint
CREATE INDEX "invoices_status_due_idx" ON "invoices" USING btree ("status","due_date");--> statement-breakpoint
ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_statement_token_uq" UNIQUE("statement_token");