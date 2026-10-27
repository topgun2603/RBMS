CREATE TABLE "expense_recurring" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"supplier_id" uuid,
	"branch_id" uuid,
	"vendor_name" text,
	"vendor_gstin" text,
	"amount" integer,
	"gst_rate" real DEFAULT 0 NOT NULL,
	"payment_method" text DEFAULT 'cash' NOT NULL,
	"due_days" integer,
	"note" text,
	"mode" text DEFAULT 'auto' NOT NULL,
	"frequency" text NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"day_of_month" integer,
	"weekday" integer,
	"start_date" date NOT NULL,
	"end_date" date,
	"next_run_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_recurring_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recurring_id" uuid NOT NULL,
	"run_date" date NOT NULL,
	"status" text NOT NULL,
	"expense_id" uuid,
	"error" text,
	"trigger" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_recurring_runs_date_uq" UNIQUE("recurring_id","run_date")
);
--> statement-breakpoint
CREATE TABLE "sales_debit_note_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"debit_note_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_debit_note_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"fy" text NOT NULL,
	"prefix" text NOT NULL,
	"next_seq" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_debit_note_series_tenant_branch_fy_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","branch_id","fy")
);
--> statement-breakpoint
CREATE TABLE "sales_debit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"branch_id" uuid,
	"customer_id" uuid,
	"customer" jsonb NOT NULL,
	"seller" jsonb NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_date" date NOT NULL,
	"invoice_total" integer NOT NULL,
	"number" text NOT NULL,
	"fy" text NOT NULL,
	"seq" integer NOT NULL,
	"date" date NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"place_of_supply" text NOT NULL,
	"inter_state" boolean NOT NULL,
	"lines" jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"total" integer NOT NULL,
	"paid" integer DEFAULT 0 NOT NULL,
	"due_date" date,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "amount_paid" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "recurring_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "recurring_run_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_payments" ADD COLUMN "expense_id" uuid;--> statement-breakpoint
ALTER TABLE "expense_recurring_runs" ADD CONSTRAINT "expense_recurring_runs_recurring_id_expense_recurring_id_fk" FOREIGN KEY ("recurring_id") REFERENCES "public"."expense_recurring"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_debit_note_allocations" ADD CONSTRAINT "sales_debit_note_allocations_debit_note_id_sales_debit_notes_id_fk" FOREIGN KEY ("debit_note_id") REFERENCES "public"."sales_debit_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_recurring_tenant_status_idx" ON "expense_recurring" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "expense_recurring_due_idx" ON "expense_recurring" USING btree ("status","next_run_date");--> statement-breakpoint
CREATE INDEX "expense_recurring_runs_tenant_idx" ON "expense_recurring_runs" USING btree ("tenant_id","recurring_id","run_date");--> statement-breakpoint
CREATE INDEX "sales_debit_note_allocations_tenant_note_idx" ON "sales_debit_note_allocations" USING btree ("tenant_id","debit_note_id");--> statement-breakpoint
CREATE INDEX "sales_debit_note_allocations_tenant_receipt_idx" ON "sales_debit_note_allocations" USING btree ("tenant_id","receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_debit_notes_tenant_branch_fy_seq_uq" ON "sales_debit_notes" USING btree ("tenant_id",coalesce("branch_id", '00000000-0000-0000-0000-000000000000'::uuid),"fy","seq");--> statement-breakpoint
CREATE INDEX "sales_debit_notes_tenant_invoice_idx" ON "sales_debit_notes" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "sales_debit_notes_tenant_date_idx" ON "sales_debit_notes" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "sales_debit_notes_tenant_customer_idx" ON "sales_debit_notes" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "expenses_tenant_supplier_idx" ON "expenses" USING btree ("tenant_id","supplier_id");--> statement-breakpoint
CREATE INDEX "expenses_tenant_branch_idx" ON "expenses" USING btree ("tenant_id","branch_id","date");--> statement-breakpoint
CREATE INDEX "purchase_payments_tenant_expense_idx" ON "purchase_payments" USING btree ("tenant_id","expense_id");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurring_run_uq" UNIQUE("recurring_run_id");